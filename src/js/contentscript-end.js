/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2105 Raymond Hill

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

    Home: https://github.com/gorhill/uMatrix
*/

/* global vAPI */
/* jshint multistr: true */

/******************************************************************************/
/******************************************************************************/

// Injected into content pages

(function() {

'use strict';

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    //console.debug('contentscript-end.js > not a HTLMDocument');
    return;
}

// This can also happen (for example if script injected into a `data:` URI doc)
if ( !window.location ) {
    return;
}

// This can happen
if ( typeof vAPI !== 'object' ) {
    //console.debug('contentscript-end.js > vAPI not found');
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.contentscriptEndInjected ) {
    //console.debug('contentscript-end.js > content script already injected');
    return;
}
vAPI.contentscriptEndInjected = true;

/******************************************************************************/

var localMessager = vAPI.messaging.channel('contentscript-end.js');

vAPI.shutdown.add(function() {
    localMessager.close();
});

/******************************************************************************/
/******************************************************************************/

// Executed only once.

(function() {
    var localStorageHandler = function(mustRemove) {
        if ( mustRemove ) {
            window.localStorage.clear();
            window.sessionStorage.clear();
            // console.debug('HTTP Switchboard > found and removed non-empty localStorage');
        }
    };

    // Check with extension whether local storage must be emptied
    // rhill 2014-03-28: we need an exception handler in case 3rd-party access
    // to site data is disabled.
    // https://github.com/gorhill/httpswitchboard/issues/215
    try {
        var hasLocalStorage = window.localStorage && window.localStorage.length;
        var hasSessionStorage = window.sessionStorage && window.sessionStorage.length;
        if ( hasLocalStorage || hasSessionStorage ) {
            localMessager.send({
                    what: 'contentScriptHasLocalStorage',
                    url: window.location.href
            }, localStorageHandler);
        }

        // TODO: indexedDB
        if ( window.indexedDB && !!window.indexedDB.webkitGetDatabaseNames ) {
            // var db = window.indexedDB.webkitGetDatabaseNames().onsuccess = function(sender) {
            //    console.debug('webkitGetDatabaseNames(): result=%o', sender.target.result);
            // };
        }

        // TODO: Web SQL
        if ( window.openDatabase ) {
            // Sad:
            // "There is no way to enumerate or delete the databases available for an origin from this API."
            // Ref.: http://www.w3.org/TR/webdatabase/#databases
        }
    }
    catch (e) {
    }
})();

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uMatrix/issues/45

var collapser = (function() {
    var timer = null;
    var requestId = 1;
    var newRequests = [];
    var pendingRequests = {};
    var pendingRequestCount = 0;
    var srcProps = {
        'img': 'src'
    };
    var reURLplaceholder = /\{\{url\}\}/g;

    var PendingRequest = function(target) {
        this.id = requestId++;
        this.target = target;
        pendingRequests[this.id] = this;
        pendingRequestCount += 1;
    };

    // Because a while ago I have observed constructors are faster than
    // literal object instanciations.
    var BouncingRequest = function(id, tagName, url) {
        this.id = id;
        this.tagName = tagName;
        this.url = url;
        this.blocked = false;
    };

    var onProcessed = function(response) {
        if ( !response ) {
            return;
        }

        var requests = response.requests;
        if ( requests === null || Array.isArray(requests) === false || !requests.length) {
            return;
        }

        var collapse = response.collapse;
        var placeholders = response.placeholders;
        var i = requests.length;
        var request, entry, target, tagName, docurl, replaced;

        while ( i-- ) {
            request = requests[i];
            if ( pendingRequests.hasOwnProperty(request.id) === false ) {
                continue;
            }
            entry = pendingRequests[request.id];
            delete pendingRequests[request.id];
            pendingRequestCount -= 1;

            // Not blocked
            if ( !request.blocked ) {
                continue;
            }

            target = entry.target;

            // No placeholders
            if ( collapse ) {
                target.style.setProperty('display', 'none', 'important');
                continue;
            }

            tagName = target.localName;

            // Special case: iframe
            if ( tagName === 'iframe' ) {
                docurl = 'data:text/html,' + encodeURIComponent(placeholders.iframe.replace(reURLplaceholder, request.url));
                replaced = false;
                // Using contentWindow.location prevent tainting browser
                // history -- i.e. breaking back button (seen on Chromium).
                if ( target.contentWindow ) {
                    try {
                        target.contentWindow.location.replace(docurl);
                        replaced = true;
                    } catch(ex) {
                    }
                }
                if ( !replaced ) {
                    target.setAttribute('src', docurl);
                }
                continue;
            }

            // Everything else
            target.setAttribute(srcProps[tagName], placeholders[tagName]);
            target.style.setProperty('border', placeholders.border, 'important');
            target.style.setProperty('background', placeholders.background, 'important');
        }

        // Renew map: I believe that even if all properties are deleted, an
        // object will still use more memory than a brand new one.
        if ( pendingRequestCount === 0 ) {
            pendingRequests = {};
        }
    };

    var blockEvent = function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    };

    var onKeyDown = function(e) {
      // For debouncing notificaitons
      var notificationTimer = null;

      // Ignore if following modifier is active.
      if (e.getModifierState("Fn") ||
          e.getModifierState("Hyper") ||
          e.getModifierState("OS") ||
          e.getModifierState("Super") ||
          e.getModifierState("Win") /* hack for IE */) {
        return;
      }

      // Ignore special keys
      var keyCodes = { 3 : "break", 8 : "backspace / delete", 9 : "tab", 12 : 'clear', 13 : "enter", 16 : "shift", 17 : "ctrl", 18 : "alt", 19 : "pause/break", 20 : "caps lock", 27 : "escape", 32 : "spacebar", 33 : "page up", 34 : "page down", 35 : "end", 36 : "home ", 37 : "left arrow ", 38 : "up arrow ", 39 : "right arrow", 40 : "down arrow ", 41 : "select", 42 : "print", 43 : "execute", 44 : "Print Screen", 45 : "insert ", 46 : "delete", 91 : "Windows Key / Left ⌘ / Chromebook Search key", 92 : "right window key ", 93 : "Windows Menu / Right ⌘", 112 : "f1 ", 113 : "f2 ", 114 : "f3 ", 115 : "f4 ", 116 : "f5 ", 117 : "f6 ", 118 : "f7 ", 119 : "f8 ", 120 : "f9 ", 121 : "f10", 122 : "f11", 123 : "f12", 124 : "f13", 125 : "f14", 126 : "f15", 127 : "f16", 128 : "f17", 129 : "f18", 130 : "f19", 131 : "f20", 132 : "f21", 133 : "f22", 134 : "f23", 135 : "f24", 144 : "num lock ", 145 : "scroll lock", 166 : "page backward", 167 : "page forward", 166 : "page backward", 167 : "page forward", 173 : "minus (firefox), mute/unmute", 174 : "decrease volume level", 175 : "increase volume level", 176 : "next", 177 : "previous", 178 : "stop", 179 : "play/pause", 180 : "e-mail", 181 : "mute/unmute (firefox)", 182 : "decrease volume level (firefox)", 183 : "increase volume level (firefox)", 224 : "left or right ⌘ key (firefox)", 225 : "altgr", 230 : "GNOME Compose Key", 233 : "XF86Forward", 234 : "XF86Back", 255 : "toggle touchpad" };
      if (keyCodes[e.keyCode]) {
        return;
      }

      // Handle shortcut keys with standard modifier
      if ((e.ctrlKey || e.metaKey || e.altKey)
          && !keyCodes[e.keyCode]
          // Uncomment to block copy and paste
          /*&& e.key.toLowerCase() !== 'c'
          && e.key.toLowerCase() !== 'v'*/) {
            return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (notificationTimer === null) {
        localMessager.send({
                what: 'notifyBlockedRequest',
                url: window.location.href
        });

        notificationTimer = vAPI.setTimeout(function() {
          clearTimeout(notificationTimer);
          notificationTimer = null;
        }, 8000); // NOTE: 8s is default chrome notification timeout
      }

      return false;
    };

    var send = function() {
        timer = null;
        localMessager.send({
            what: 'evaluateURLs',
            requests: newRequests
        }, onProcessed);
        newRequests = [];
    };

    var process = function(delay) {
        localMessager.send({ what: 'shutdown?' }, function(res) {
            if (!res) {
              // Block other key events to prevent scripts from keylogging
              document.addEventListener('keypress', blockEvent, true);
              document.addEventListener('keyup', blockEvent, true);

              // Use addEventListener to start capture of all events (globally)
              document.addEventListener('keydown', onKeyDown, true);
            }
        });
      
        if ( newRequests.length === 0 ) {
            return;
        }
        if ( delay === 0 ) {
            clearTimeout(timer);
            send();
        } else if ( timer === null ) {
            timer = vAPI.setTimeout(send, delay || 50);
        }
    };

    var iframeSourceModified = function(mutations) {
        var i = mutations.length;
        while ( i-- ) {
            addFrameNode(mutations[i].target, true);
        }
        process();
    };
    var iframeSourceObserver = null;
    var iframeSourceObserverOptions = {
        attributes: true,
        attributeFilter: [ 'src' ]
    };

    var addFrameNode = function(iframe, dontObserve) {
        // https://github.com/gorhill/uBlock/issues/162
        // Be prepared to deal with possible change of src attribute.
        if ( dontObserve !== true ) {
            if ( iframeSourceObserver === null ) {
                iframeSourceObserver = new MutationObserver(iframeSourceModified);
            }
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }
        // https://github.com/chrisaljoudi/uBlock/issues/174
        // Do not remove fragment from src URL
        var src = iframe.src;
        if ( src.lastIndexOf('http', 0) !== 0 ) {
            return;
        }
        var req = new PendingRequest(iframe);
        newRequests.push(new BouncingRequest(req.id, 'iframe', src));
    };

    var addNode = function(target) {
        var tagName = target.localName;
        if ( tagName === 'iframe' ) {
            addFrameNode(target);
            return;
        }
        var prop = srcProps[tagName];
        if ( prop === undefined ) {
            return;
        }
        // https://github.com/chrisaljoudi/uBlock/issues/174
        // Do not remove fragment from src URL
        var src = target[prop];
        if ( typeof src !== 'string' || src === '' ) {
            return;
        }
        if ( src.lastIndexOf('http', 0) !== 0 ) {
            return;
        }
        var req = new PendingRequest(target);
        newRequests.push(new BouncingRequest(req.id, tagName, src));
    };

    var addNodes = function(nodes) {
        var node;
        var i = nodes.length;
        while ( i-- ) {
            node = nodes[i];
            if ( node.nodeType === 1 ) {
                addNode(node);
            }
        }
    };

    var addBranches = function(branches) {
        var root;
        var i = branches.length;
        while ( i-- ) {
            root = branches[i];
            if ( root.nodeType === 1 ) {
                addNode(root);
                // blocked images will be reported by onResourceFailed
                addNodes(root.querySelectorAll('iframe'));
            }
        }
    };

    // Listener to collapse blocked resources.
    // - Future requests not blocked yet
    // - Elements dynamically added to the page
    // - Elements which resource URL changes
    var onResourceFailed = function(ev) {
        addNode(ev.target);
        process();
    };
    document.addEventListener('error', onResourceFailed, true);

    vAPI.shutdown.add(function() {
        if ( timer !== null ) {
            clearTimeout(timer);
            timer = null;
        }
        if ( iframeSourceObserver !== null ) {
            iframeSourceObserver.disconnect();
            iframeSourceObserver = null;
        }
        document.removeEventListener('error', onResourceFailed, true);
        newRequests = [];
        pendingRequests = {};
        pendingRequestCount = 0;
    });

    return {
        addNodes: addNodes,
        addBranches: addBranches,
        process: process
    };
})();

/******************************************************************************/
/******************************************************************************/

var hasInlineScript = function(nodeList, summary) {
    var i = 0;
    var node, text;
    while ( (node = nodeList.item(i++)) ) {
        if ( node.nodeType !== 1 ) {
            continue;
        }
        if ( typeof node.localName !== 'string' ) {
            continue;
        }

        if ( node.localName === 'script' ) {
            // https://github.com/gorhill/httpswitchboard/issues/252
            // Do not count uMatrix's own script tags, they are not required
            // to "unbreak" a web page
            if ( typeof node.id === 'string' && ownScripts[node.id] ) {
                continue;
            }
            text = node.textContent.trim();
            if ( text === '' ) {
                continue;
            }
            summary.inlineScript = true;
            break;
        }

        if ( node.localName === 'a' && node.href.lastIndexOf('javascript', 0) === 0 ) {
            summary.inlineScript = true;
            break;
        }
    }
    if ( summary.inlineScript ) {
        summary.mustReport = true;
    }
};

var ownScripts = {
    'umatrix-ua-spoofer': true
};

/******************************************************************************/

var nodeListsAddedHandler = function(nodeLists) {
    var i = nodeLists.length;
    if ( i === 0 ) {
        return;
    }
    var summary = {
        what: 'contentScriptSummary',
        locationURL: window.location.href,
        inlineScript: false,
        mustReport: false
    };
    while ( i-- ) {
        if ( summary.inlineScript === false ) {
            hasInlineScript(nodeLists[i], summary);
        }
        collapser.addBranches(nodeLists[i]);
    }
    if ( summary.mustReport ) {
        localMessager.send(summary);
    }
    collapser.process();
};

/******************************************************************************/
/******************************************************************************/

// Executed only once.

(function() {
    var summary = {
        what: 'contentScriptSummary',
        locationURL: window.location.href,
        inlineScript: false,
        mustReport: true
    };
    // https://github.com/gorhill/httpswitchboard/issues/25
    // &
    // Looks for inline javascript also in at least one a[href] element.
    // https://github.com/gorhill/httpswitchboard/issues/131
    hasInlineScript(document.querySelectorAll('a[href^="javascript:"],script'), summary);

    //console.debug('contentscript-end.js > firstObservationHandler(): found %d script tags in "%s"', Object.keys(summary.scriptSources).length, window.location.href);

    localMessager.send(summary);

    collapser.addNodes(document.querySelectorAll('iframe,img'));
    collapser.process();
})();

/******************************************************************************/
/******************************************************************************/

// Observe changes in the DOM

// Added node lists will be cumulated here before being processed

(function() {
    var addedNodeLists = [];
    var addedNodeListsTimer = null;

    var treeMutationObservedHandler = function() {
        nodeListsAddedHandler(addedNodeLists);
        addedNodeListsTimer = null;
        addedNodeLists = [];
    };

    // https://github.com/gorhill/uBlock/issues/205
    // Do not handle added node directly from within mutation observer.
    var treeMutationObservedHandlerAsync = function(mutations) {
        var iMutation = mutations.length;
        var nodeList;
        while ( iMutation-- ) {
            nodeList = mutations[iMutation].addedNodes;
            if ( nodeList.length !== 0 ) {
                addedNodeLists.push(nodeList);
            }
        }
        // I arbitrarily chose 250 ms for now:
        // I have to compromise between the overhead of processing too few
        // nodes too often and the delay of many nodes less often. There is nothing
        // time critical here.
        if ( addedNodeListsTimer === null ) {
            addedNodeListsTimer = vAPI.setTimeout(treeMutationObservedHandler, 250);
        }
    };

    // This fixes http://acid3.acidtests.org/
    if ( !document.body ) {
        return;
    }

    // https://github.com/gorhill/httpswitchboard/issues/176
    var treeObserver = new MutationObserver(treeMutationObservedHandlerAsync);
    treeObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    vAPI.shutdown.add(function() {
        if ( addedNodeListsTimer !== null ) {
            clearTimeout(addedNodeListsTimer);
            addedNodeListsTimer = null;
        }
        if ( treeObserver !== null ) {
            treeObserver.disconnect();
            treeObserver = null;
        }
        addedNodeLists = [];
    });
})();

/******************************************************************************/
/******************************************************************************/

localMessager.send({ what: 'shutdown?' }, function(response) {
    if ( response === true ) {
        vAPI.shutdown.exec();
    }
});

/******************************************************************************/
/******************************************************************************/

})();
