/*******************************************************************************

    µBlock - a browser extension to block requests.
    Copyright (C) 2014 The µBlock authors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

// For non background pages

/******************************************************************************/

(function(self) {

'use strict';

/******************************************************************************/

var vAPI = self.vAPI = self.vAPI || {};
var chrome = self.chrome;

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.vapiClientInjected ) {
    //console.debug('vapi-client.js already injected: skipping.');
    return;
}
vAPI.vapiClientInjected = true;

vAPI.sessionId = String.fromCharCode(Date.now() % 25 + 97) +
    Math.random().toString(36).slice(2);
vAPI.chrome = true;

/******************************************************************************/

vAPI.shutdown = (function() {
    var jobs = [];

    var add = function(job) {
        jobs.push(job);
    };

    var exec = function() {
        //console.debug('Shutting down...');
        var job;
        while ( job = jobs.pop() ) {
            job();
        }
    };

    return {
        add: add,
        exec: exec
    };
})();

/******************************************************************************/

var messagingConnector = function(response) {
    if ( !response ) {
        return;
    }

    var channels = vAPI.messaging.channels;
    var channel, listener;

    if ( response.broadcast === true && !response.channelName ) {
        for ( channel in channels ) {
            if ( channels.hasOwnProperty(channel) === false ) {
                continue;
            }
            listener = channels[channel].listener;
            if ( typeof listener === 'function' ) {
                listener(response.msg);
            }
        }
        return;
    }

    if ( response.requestId ) {
        listener = vAPI.messaging.listeners[response.requestId];
        delete vAPI.messaging.listeners[response.requestId];
        delete response.requestId;
    }

    if ( !listener ) {
        channel = channels[response.channelName];
        listener = channel && channel.listener;
    }

    if ( typeof listener === 'function' ) {
        listener(response.msg);
    }
};

/******************************************************************************/

vAPI.messaging = {
    port: null,
    channels: {},
    listeners: {},
    requestId: 1,

    setup: function() {
        this.port = chrome.runtime.connect({name: vAPI.sessionId});
        this.port.onMessage.addListener(messagingConnector);
    },

    close: function() {
        if ( this.port === null ) {
            return;
        }
        this.port.disconnect();
        this.port.onMessage.removeListener(messagingConnector);
        this.port = null;
        this.channels = {};
        this.listeners = {};
    },

    channel: function(channelName, callback) {
        if ( !channelName ) {
            return;
        }

        this.channels[channelName] = {
            channelName: channelName,
            listener: typeof callback === 'function' ? callback : null,
            send: function(message, callback) {
                if ( vAPI.messaging.port === null ) {
                    vAPI.messaging.setup();
                }

                message = {
                    channelName: this.channelName,
                    msg: message
                };

                if ( callback ) {
                    message.requestId = vAPI.messaging.requestId++;
                    vAPI.messaging.listeners[message.requestId] = callback;
                }
                vAPI.messaging.port.postMessage(message);
            },
            close: function() {
                delete vAPI.messaging.channels[this.channelName];
                if ( Object.keys(vAPI.messaging.channels).length === 0 ) {
                    vAPI.messaging.close();
                }
            }
        };

        return this.channels[channelName];
    }
};

/******************************************************************************/

// No need to have vAPI client linger around after shutdown if
// we are not a top window (because element picker can still
// be injected in top window).
if ( window !== window.top ) {
    vAPI.shutdown.add(function() {
        vAPI = null;
    });
}

/******************************************************************************/

vAPI.setTimeout = vAPI.setTimeout || function(callback, delay) {
    setTimeout(function() { callback(); }, delay);
};

/******************************************************************************/

})(this);

/******************************************************************************/
