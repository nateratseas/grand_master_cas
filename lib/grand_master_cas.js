var http = require('http');
var https = require('https');
var fs = require('fs');
var url = require('url');

var GrandMasterCas = function(){
  this.configure = this.configure.bind(this);
  this.bouncer = this.bouncer.bind(this);
  this.blocker = this.blocker.bind(this);
  this.handler = this.handler.bind(this);
  this.handleTicket = this.handleTicket.bind(this);
  this.logout = this.logout.bind(this);
};

GrandMasterCas.prototype.configure = function(opts){
  if (!opts){
    console.log( 'please pass an object into configure' );
    opts = {};
  }

  this.casScheme = opts.ssl === true ? 'https' : 'http';
  this.defaultAgent = opts.ssl === true ? https : http;
  this.ssl = !!opts.ssl;
  var defaultPort = opts.ssl === true ? 443 : 80;
  this.port = opts.casPort || defaultPort;
  this.casHost  = opts.casHost || '';
  this.casPath  = opts.casPath || '/cas';
  this.endPointIsOrigin = opts.endPointIsOrigin || false;
  this.endPoint = '';
  this.isDev = opts.isDev || false;
  this.devUser = opts.devUser || '';

  var service = opts.service || '';
  this.service = encodeURIComponent(service);
  this.sessionName = opts.sessionName || "cas_user";
  this.renew = !!opts.renew;
  this.gateway = !!opts.gateway;
  this.redirectUrl = opts.redirectUrl || '/';
  if (opts.caFile) {
     this.ca = fs.readFileSync(opts.caFile);
     console.log('custom CA loaded');
   } else {
     this.ca = '';
   }
};


GrandMasterCas.prototype.blocker = function(req, res, next){
  if(this.isDev){
    req.session.cas_user = this.devUser;
    console.log('###########################################################');
    console.log('## Running application in DEV mode with user ' + this.devUser);
    console.log('## CHANGE THIS BEFORE GOING TO PRODUCTION');
    console.log('###########################################################')
    next();
  }else{
    if(this.endPointIsOrigin){
      this.endPoint = url.parse(req.originalUrl).pathname;
      if(req.query.endPoint){
        this.endPoint+='?endPoint='+req.query.endPoint.replace('#','___');
      }
    }   
    if (!this.redirectUrl) {
      throw new Error('GrandMasterCAS must have a redirectUrl');
    } else {
      this.handler(req, res, next, this.redirectUrl);
    }
  }
};

GrandMasterCas.prototype.bouncer = function(req, res, next){
  var redirectParts = [this.casScheme, '://',
                     this.casHost, ':', this.port,
                     this.casPath, '/login?service=',
                     this.service];  
  if(this.endPointIsOrigin){                   
    redirectParts.push(this.endPoint);   
  }  
  var redirectUrl = redirectParts.join('');
  this.handler(req, res, next, redirectUrl);
};


GrandMasterCas.prototype.handler = function(req, res, next, redirectUrl){
  var sessionName = this.sessionName;
  if (req.session[sessionName]) {
    next();
  }else if (req.query && req.query.ticket) {
    if(this.endPoint){
      this.endPoint.replace('#','___');
    }
    if(this.redirectUrl){
      this.redirectUrl = redirectUrl.replace('___','#');
    }
    this.handleTicket(req, res, next);
  }else {
    res.redirect(redirectUrl.replace('%23','%5F%5F%5F'));
  }
};

GrandMasterCas.prototype.handleTicket = function( req, res, next ){
  var ticket = req.query.ticket;
  var endPoint = this.endPoint;
  var sessionName = this.sessionName;
  var service = this.service;
  var path = this.casPath + '/validate?service=' + service;
  if(this.endPointIsOrigin && endPoint){
    path += this.endPoint;
  }
  path += '&ticket=' + ticket;

  var that = this;

  var request = https.request({
    host: this.casHost,
    path: path,    
    ca: this.ca,
    method: 'GET'
  }, function(response){
    var buf = '';
    var redirectUrl;
    response.on('data', function(chunk){
      buf += chunk.toString('utf8');
    });
    response.on('end', function(){
      var results = buf.split('\n');
      if (results[0] === 'yes') {
        req.session[sessionName] = results[1];
        next();
      }
      else if (results[0] === 'no') {
        // thisBinding is lost here
        res.write('failure response from CAS server.');
        res.write('this is probably not an issue with the CAS server. please check your validation request.');
        res.end();
      }
      else {
        console.log('invalid response from CAS');
      }
    });
    response.on('error', function(err){
      console.log('response error: ' + err);
    });
  });

  request.on( 'error', function(err){
    console.log( 'error: ' + err );
  });

  request.end();
};

GrandMasterCas.prototype.logout = function(req, res){
  var logoutUrl = [this.casScheme, '://',
                   this.casHost, ':', this.port,
                   this.casPath, '/logout'].join('');

  delete req.session[this.sessionName];
  // Doesn't destroy the whole session!
  res.redirect(logoutUrl);
};

module.exports = new GrandMasterCas;
