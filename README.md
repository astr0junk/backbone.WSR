# Inspired by
* Backbone.WS by Yehonatan Daniv
* https://github.com/ydaniv/backbone-ws
* @license BSD License 


# backbone.WSR
Library for WebSocket Requesting for Backbone Models and Collections.
This library will override Backbone.Sync method. If it will find a correct event name and dataschema for sending by WebSocket - it will send it!
All messaging makes in binary frame format (by ArrayBuffer).
Expected response from server in binary frame format too.

# Usage example

load library after/with Backbone

create wsPoint instance

`var wsr = new WSR('wss://YourWebSocketPoint/', {expectSeconds: 5, debug: true});`

wsr.on('ws:open',function(){
  //start your app here
})

Now you need add wSmethodMap object for all your models and collections by analogy of Backbone methodMap

# wsMethodMap - wtf?

Backbone Classes will call REST methods like create, update etc. In wSmethodMap you must config which requests will be send by WebSocket.
'name' property will be used for request field in message for server 'session:create' for example.
WSR will get only these keys from model which you config in 'schema' property.
```
 var methodMap = {
        'create': 'POST',
        'update': 'PUT',
        'patch': 'PATCH',
        'delete': 'DELETE',
        'read': 'GET'
    };
```
=>

Example
```
var wsMethodMap = {
     'read': { name: 'session:create', schema: function() { return YOUR_REQEST_DATA_OBJECT; }}
}

var sessionModel = new SessionModel({wSmethodMap: wsMethodMap});

sessionModel.fetch() => sending data "{"data":{},"request":"session:create"}"
```

After sending will be created a promise object which will be rejected and assert after `expectSeconds` value from WSR config
or resolved if server will responsed with `response` field with value `session:create`. For example:
```
"{"response":"session:create", "data":{"session":{"user_uuid":"","token":"9d602d7e57294812b68c76531c202eb7d41d8cd98f00b204e9800998ecf8427e"}}}"
```

Request and response properties value MUST be equal if you want to trigger callbacks on 'onmessage' by promises




