/*
 * Backbone.WSR
 * @version 0.0.1
*/
(function (root, factory) {
    if ( typeof define === 'function' && define.amd ) {
        // AMD
        define(['backbone', 'underscore'], function (Backbone, underscore) {
            return factory(root, Backbone, underscore);
        });
    }
    else if ( typeof exports === 'object' ) {
        // CommonJS
        return factory(root, require('backbone'), require('underscore'));
    }
    else {
        // Browser globals
        factory(root, root.Backbone, root._);
    }
}(this, function (root, Backbone, _) {

    function ab2str(buf) {

        var buffer = new Uint8Array(buf),
            length = buffer.byteLength,
            chunkLength = 8;

        var string = '';

        if (length < chunkLength) {
            return JSON.parse(String.fromCharCode.apply(null, buffer));
        }

        for (var i = 0; i < length; i = i + chunkLength) {

            var begin = i,
                end;

            if (begin > length) {
                break;
            }

            if ((length - 1 - begin) > chunkLength) {
                end = begin + chunkLength;
            } else {
                end = length;
            }

            var chunk = buffer.slice(begin, end);

            string += String.fromCharCode.apply(null, chunk);


        }

        return JSON.parse(decodeURIComponent(escape(string)));

    }

    function str2ab(str) {
        var buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
        var bufView = new Uint16Array(buf);
        for (var i=0, strLen=str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    }

    var ajaxSync = Backbone.sync;

    function WSR (url, options) {
        var self = this;

        if ( ! url ) {
            throw new Error('URL not provided.');
        }
        if ( ! (this instanceof WSR) ) {
            return new WSR(url, options);
        }

        this.options = options = options || {};
        this.url = url;
        this.isOpen = false;

        this.prefix = options.prefix === void 0 ?
            'ws:' :
            options.prefix ? options.prefix + ':' : '';
        this.typeAttribute = 'typeAttribute' in options ? options.typeAttribute : 'type';
        this.dataAttribute = 'dataAttribute' in options ? options.dataAttribute : 'data';
        this.sendAttribute = options.sendAttribute || 'send';
        this.debug =  options.debug ? options.debug : null;
        this.reopen = 'reopen' in options ? options.reopen : true;
        this.retries = 'retries' in options ? options.retries : 3;
        this.heartbeat_timeout = options.heartbeat_timeout || 120000;
        this.reopenTimeout = options.reopenTimeout ? options.reopenTimeout : 3000;
        this.expectSeconds = (options.expectSeconds || 7) * 1000;
        this.expectation = 'expect' in options ? options.expect : null;
        this.resources = [];
        this.defaultEvents = {};
        this.reopenTry = null;
        this.binaryType = 'arraybuffer';

        // cache retries
        this.options.retries = this.retries;

        ['open', 'message', 'close', 'error', 'noretries'].forEach(function (event) {
            this.defaultEvents[this.prefix + event] = true
        }, this);

        var resources = Array.isArray(options.resources) ? options.resources : [];

        resources.forEach(function (resource) {
            if ( Array.isArray(resource) ) {
                this.bind.apply(this, resource);
            }
            else if ( resource && resource.resource && resource.events ) {
                this.bind(resource.resource, resource.events);
            }
        }, this);

        this.open();


        root.Backbone.sync = function(){
            self.sync.apply(self,arguments);
        };

        return this;
    }

    function Expectation (req, options) {
        var self = this,
            expectation = this.Expectation.prototype;

        return this.promise = new this.Promise(function (resolve, reject) {
            this._handler = function (data, type) {
                if ( expectation.assert(data, type) ) {
                    expectation.kill.call(self);
                    resolve(data);
                }
            };

            this.on('response:'+req.request, this._handler, this);

            this.timeout_id = root.setTimeout(function () {
                reject(new Error('Timeout'));
            }, this.expectSeconds);

        }.bind(this));
    }

    Expectation.prototype.kill = function () {
        root.clearTimeout(this.timeout_id);
        this.off(this._topic, this._handler);
    };

    Expectation.prototype.assert = function (data, type) {
        var exp = this.expectation,
            exp_type;

        if ( exp ) {
            exp_type = typeof exp;

            if ( exp_type == 'function' ) {
                return exp.call(this, data, type);
            }
            else if ( exp_type == 'string' ) {
                return type ? type == exp :
                    typeof data == 'string' ?
                    data == exp :
                    data[this.instance.typeAttribute] == exp;
            }

            return Object.keys(this.expectation).every(function (key) {
                return exp_type[key] === data[key];
            });
        }
        return true;
    };

    _.extend(WSR.prototype, Backbone.Events, {
        open : function () {
            this.socket = this.options.protocol ?
                new root.WebSocket(this.url, this.options.protocol) :
                new root.WebSocket(this.url);

            this.socket.binaryType = this.binaryType;
            this.socket.onopen = this.onopen.bind(this);
            this.socket.onmessage = this.onmessage.bind(this);
            this.socket.onerror = this.onerror.bind(this);
            this.socket.onclose = this.onclose.bind(this);
        },
        onopen   : function () {
            var self = this;
            this.isOpen = true;
            this.retries = this.options.retries;

            if ( this.debug ) {
                console.info('$$$ OPEN');
            }
            setTimeout(function(){
                self.trigger(self.prefix + 'open');
            },1000);


            this.missed_heartbeats = 0;

            this.heartbeat_interval = setInterval(function() {

                try {
                    self.missed_heartbeats++;
                    if (self.missed_heartbeats >= 5)
                        throw new Error("Too many missed heartbeats.");
                    self.send({
                        "request": "node:ping"
                    });

                } catch(e) {
                    clearInterval(this.heartbeat_interval);
                    this.heartbeat_interval = null;
                    console.warn("Closing connection. Reason: " + e.message);
                    self.trigger('close');
                }

            }, self.heartbeat_timeout);


        },
        onmessage: function (event) {

            var data, type = 'response';

                data = ab2str(event.data);


                if ( this.debug && this.debug.incoming ) {
                    console.log('%c<<<"'+data.response+':',"color: red;font-size: 1.1em", data, new Date());
                }

                if ( !!data['response'] ) {

                    if (data['response'] ===  "node:ping") {
                        this.missed_heartbeats = 0;
                        return;
                    }

                    this.trigger('response:'+data.response, data['data']);
                }

                if (!!data['event']) {
                    this.trigger('server:event', data);
                }


        },
        onerror  : function (error) {
            if ( this.debug ) {
                console.error('!!! ERROR ', error, this.isOpen);
            }

            this.trigger(this.prefix + 'error', error, this.isOpen);
        },
        onclose  : function (event) {

            this.isOpen = false;

            if ( this.debug ) {
                console.info('!!! CLOSED ', event);
            }

            this.trigger(this.prefix + 'close', event);

            if ( this.reopen && this.socket ) {

                if ( this.retries ) {
                    this.retries -= 1;

                    if ( this.reopenTry ) {
                        root.clearTimeout(this.reopenTry);
                    }

                    this.reopenTry = root.setTimeout(this.open.bind(this), this.reopenTimeout);
                }
                else {
                    this.trigger(this.prefix + 'noretries', event);
                }

            }

            if (!!this.heartbeat_interval){
                clearInterval(this.heartbeat_interval);
                this.heartbeat_interval = null;
            }

        },
        destroy  : function () {

            if ( this.reopenTry ) {
                root.clearTimeout(this.reopenTry);
            }

            !!this.socket && this.socket.close();
            this.socket = null;
            this.resources = [];
        },
        waitForConnection : function (callback, interval) {
            if (this.socket.readyState === 1) {
                callback();
            } else {
                var that = this;
                // optional: implement backoff for interval here
                setTimeout(function () {
                    that.waitForConnection(callback, interval);
                }, interval);
            }
        },
        send : function (data) {
            var self = this;
            
            this.waitForConnection(function () {
                if ( self.socket ) {

                    if ( self.debug && self.debug.send) {
                        console.log('%c>>>"'+data.request+':',"color: red;font-size: 1.1em", data, new Date());
                    }

                    self.socket.send(str2ab(JSON.stringify(data)));
                }
                else {
                    throw new Error('WebSocket not opened yet!');
                }

            }, 1000);
        },
        sync : function (method, model, options) {

            if ( options.xhr ) {
                return ajaxSync.call(Backbone, method, model, options);
            }

            if (!model.wsMethodMap) {
                console.log('WebSocket method not find in wsMethodMap');
                return;
            }

            var req = {data:{}};

            if ( ! req.request ) {
                req.request = model.wsMethodMap[method].name;
            }

            if (!!model.wsMethodMap[method].schema) {
                req['data'] = options.data || options.attrs || model.wsMethodMap[method].schema.call(model);
            } else {
                req['data'] = model.toJSON()
            }

            if ( typeof options.beforeSend == 'function' ) {
                options.beforeSend.apply(model, arguments);
            }

            this.send(req);

            model.trigger('request', model, this.socket, options);

            if (!!options.wait){
                var expect = this.Expectation(req, options);
                expect.then(options.success, options.error);
            } else {
                (!!options.success && typeof options.success == 'function') && options.success.call();
            }

            return expect;
        }
    });

    if ( root.Promise ) {
        WSR.prototype.Promise = root.Promise;
    }

    WSR.prototype.Expectation = Expectation;

    return WSR;
}));
