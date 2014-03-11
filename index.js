'use strict';

var util = require('util');
var stream = require('stream');

var hue = require('node-hue-api');
var hueapi = new hue.HueApi();

function HueDriver(config, app) {
  this.config = config;
  this.app = app;

  this.seen = {};

  app.once('client::up', function() {
    setInterval(this.findBridges.bind(this), 5 * 60 * 1000);
    this.findBridges();
  }.bind(this));

}
util.inherits(HueDriver, stream);

HueDriver.prototype.findBridges = function() {
  var log = this.app.log;

  log.debug('Hue> Searching for bridges');

  hue.locateBridges(function(err, result) {

      if (err) {
        return log.error('Hue> Failed to search for bridges', err);
      }
      result.forEach(function(bridge) {
        
        if (this.seen[bridge.id]) {
          return;
        }

        this.seen[bridge.id] = bridge.ipaddress;

        log.info('Hue> Found bridge', bridge);

        if (this.config[bridge.id]) {

          log.debug('Hue> Have username for bridge', bridge.ipaddress, this.config[bridge.id]);
          this.addBridge(bridge);

        } else {
          log.info('Hue> No configuration. Starting registration.');
          this.registerBridge(bridge);
          this.emit('announcement', {
            'contents': [
              {'type': 'heading',      'text': 'New Philips Hue Link Detected' },
              {'type': 'paragraph',    'text': 'To enable your Hue lights on the dashboard please press the link button on your Hue base station.' }
            ]
          });
        }
      }.bind(this));
  }.bind(this));
};

HueDriver.prototype.registerBridge = function(bridge) {
  var log = this.app.log;

  hueapi.createUser(bridge.ipaddress, function(err, user) {
    if (err) {
      var retryTime = 10000;
      if (err.type == 101) {
        retryTime = 200;
      } else {
        log.error('Hue> Failed to add a user to the bridge.', err);
      }
      
      setTimeout(function() {
        this.registerBridge(bridge);
      }.bind(this), retryTime);

      return;
    }

    this.config[bridge.id] = user;
    this.save(this.config);

    log.info('Hue> Got user', user, 'for bridge', bridge);
    this.addBridge(bridge);
  }.bind(this));
};

HueDriver.prototype.addBridge = function(bridge) {
  var log = this.app.log;
  var api = new hue.HueApi(bridge.ipaddress, this.config[bridge.id]);

  api.getFullState(function(err, state) {
    if (err) {
      return log.error('Hue> Failed to get bridge state', err);
    }

    log.debug('Hue> Full state for bridge', bridge, JSON.stringify(state, 2, 2));

    for (var lightId in state.lights) {
      this.addLight(api, bridge.id, lightId, state.lights[lightId]);
    }

  }.bind(this));
};

HueDriver.prototype.addLight = function(api, stationId, lightId, light) {
  this.app.log.info('Adding light', lightId, light);

  this.emit('register', new Light(api, stationId, lightId, light.name, light.state));
};

function Light(api, stationId, id, name, state) {
  this.readable = true;
  this.writeable = true;
  this.V = 0;
  this.D = 1008;
  this.name = name;
  this.G = stationId + id;

  this.id = id;
  this.api = api;
  process.nextTick(function() {
    this.emit('data', state);
  }.bind(this));
}
util.inherits(Light, stream);

Light.prototype.write = function(value) {
  if (typeof value == 'string') {
    value = JSON.parse(value);
  }

  this.api.setLightState(this.id, value)
    .then(function(result) {
      this.emit('data', value);
    }.bind(this))
    .fail(function(e) {
      console.error('Hue> Failed to set light', e);
    }.bind(this))
    .done();
};


module.exports = HueDriver;