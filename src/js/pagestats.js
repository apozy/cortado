/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2013  Raymond Hill

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

/* global chrome, µMatrix */
/* jshint bitwise: false, boss: true */

/*******************************************************************************

A PageRequestStore object is used to store net requests in two ways:

To record distinct net requests

**/

µMatrix.PageRequestStats = (function() {

'use strict';

/******************************************************************************/

// Caching useful global vars

var µm = µMatrix;
var µmuri = null;

/******************************************************************************/

// Hidden vars

var typeToCode = {
    'doc'   : 'a',
    'frame' : 'b',
    'css'   : 'c',
    'script': 'd',
    'image' : 'e',
    'plugin': 'f',
    'xhr'   : 'g',
    'other' : 'h',
    'cookie': 'i'
};

var codeToType = {
    'a': 'doc',
    'b': 'frame',
    'c': 'css',
    'd': 'script',
    'e': 'image',
    'f': 'plugin',
    'g': 'xhr',
    'h': 'other',
    'i': 'cookie'
};

/******************************************************************************/

// It's just a dict-based "packer"

var stringPacker = {
    codeGenerator: 1,
    codeJunkyard: [],
    mapStringToEntry: {},
    mapCodeToString: {},

    Entry: function(code) {
        this.count = 0;
        this.code = code;
    },

    remember: function(code) {
        if ( code === '' ) {
            return;
        }
        var s = this.mapCodeToString[code];
        if ( s ) {
            var entry = this.mapStringToEntry[s];
            entry.count++;
        }
    },

    forget: function(code) {
        if ( code === '' ) {
            return;
        }
        var s = this.mapCodeToString[code];
        if ( s ) {
            var entry = this.mapStringToEntry[s];
            entry.count--;
            if ( !entry.count ) {
                // console.debug('stringPacker > releasing code "%s" (aka "%s")', code, s);
                this.codeJunkyard.push(entry);
                delete this.mapCodeToString[code];
                delete this.mapStringToEntry[s];
            }
        }
    },

    pack: function(s) {
        var entry = this.entryFromString(s);
        if ( !entry ) {
            return '';
        }
        return entry.code;
    },

    unpack: function(packed) {
        return this.mapCodeToString[packed] || '';
    },

    stringify: function(code) {
        if ( code <= 0xFFFF ) {
            return String.fromCharCode(code);
        }
        return String.fromCharCode(code >>> 16) + String.fromCharCode(code & 0xFFFF);
    },

    entryFromString: function(s) {
        if ( s === '' ) {
            return null;
        }
        var entry = this.mapStringToEntry[s];
        if ( !entry ) {
            entry = this.codeJunkyard.pop();
            if ( !entry ) {
                entry = new this.Entry(this.stringify(this.codeGenerator++));
            } else {
                // console.debug('stringPacker > recycling code "%s" (aka "%s")', entry.code, s);
                entry.count = 0;
            }
            this.mapStringToEntry[s] = entry;
            this.mapCodeToString[entry.code] = s;
        }
        return entry;
    }
};

/******************************************************************************/

var PageRequestStats = function() {
    this.requests = {};
    if ( !µmuri ) {
        µmuri = µm.URI;
    }
};

/******************************************************************************/

PageRequestStats.prototype.init = function() {
    return this;
};

/******************************************************************************/

var pageRequestStoreJunkyard = [];

var pageRequestStoreFactory = function() {
    var pageRequestStore = pageRequestStoreJunkyard.pop();
    if ( pageRequestStore ) {
        pageRequestStore.init();
    } else {
        pageRequestStore = new PageRequestStats();
    }
    return pageRequestStore;
};

/******************************************************************************/

PageRequestStats.prototype.disposeOne = function(reqKey) {
    if ( this.requests[reqKey] ) {
        delete this.requests[reqKey];
        forgetRequestKey(reqKey);
    }
};

/******************************************************************************/

PageRequestStats.prototype.dispose = function() {
    var requests = this.requests;
    for ( var reqKey in requests ) {
        if ( requests.hasOwnProperty(reqKey) === false ) {
            continue;
        }
        stringPacker.forget(reqKey.slice(3));
    }
    this.requests = {};
    if ( pageRequestStoreJunkyard.length < 8 ) {
        pageRequestStoreJunkyard.push(this);
    }
};

/******************************************************************************/

// Request key:
// index: 0123
//        THHN
//        ^^ ^
//        || |
//        || +--- short string code for hostname (dict-based)
//        |+--- FNV32a hash of whole URI (irreversible)
//        +--- single char code for type of request

var makeRequestKey = function(uri, reqType) {
    // Ref: Given a URL, returns a unique 4-character long hash string
    // Based on: FNV32a
    // http://www.isthe.com/chongo/tech/comp/fnv/index.html#FNV-reference-source
    // The rest is custom, suited for µMatrix.
    var hint = 0x811c9dc5;
    var i = uri.length;
    while ( i-- ) {
        hint ^= uri.charCodeAt(i) | 0;
        hint += (hint<<1) + (hint<<4) + (hint<<7) + (hint<<8) + (hint<<24) | 0;
        hint >>>= 0;
    }
    var key  = typeToCode[reqType] || 'z';
    return key +
           String.fromCharCode(hint >>> 22, hint >>> 12 & 0x3FF, hint & 0xFFF) +
           stringPacker.pack(µmuri.hostnameFromURI(uri));
};

/******************************************************************************/

var rememberRequestKey = function(reqKey) {
    stringPacker.remember(reqKey.slice(4));
};

var forgetRequestKey = function(reqKey) {
    stringPacker.forget(reqKey.slice(4));
};

/******************************************************************************/

// Exported

var hostnameFromRequestKey = function(reqKey) {
    return stringPacker.unpack(reqKey.slice(4));
};

PageRequestStats.prototype.hostnameFromRequestKey = hostnameFromRequestKey;

var typeFromRequestKey = function(reqKey) {
    return codeToType[reqKey.charAt(0)];
};

PageRequestStats.prototype.typeFromRequestKey = typeFromRequestKey;

/******************************************************************************/

PageRequestStats.prototype.createEntryIfNotExists = function(url, type) {
    var reqKey = makeRequestKey(url, type);
    if ( this.requests[reqKey] ) {
        return false;
    }
    rememberRequestKey(reqKey);
    this.requests[reqKey] = Date.now();
    return true;
};

/******************************************************************************/

PageRequestStats.prototype.getRequestKeys = function() {
    return Object.keys(this.requests);
};

/******************************************************************************/

PageRequestStats.prototype.getRequestDict = function() {
    return this.requests;
};

/******************************************************************************/

// Export

return {
    factory: pageRequestStoreFactory,
    hostnameFromRequestKey: hostnameFromRequestKey,
    typeFromRequestKey: typeFromRequestKey
};

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

µMatrix.PageStore = (function() {

'use strict';

/******************************************************************************/

var µm = µMatrix;
var pageStoreJunkyard = [];

/******************************************************************************/

var pageStoreFactory = function(tabContext) {
    var entry = pageStoreJunkyard.pop();
    if ( entry ) {
        return entry.init(tabContext);
    }
    return new PageStore(tabContext);
};

/******************************************************************************/

function PageStore(tabContext) {
    this.requestStats = µm.requestStatsFactory();
    this.off = false;
    this.init(tabContext);
}

/******************************************************************************/

PageStore.prototype.init = function(tabContext) {
    this.tabId = tabContext.tabId;
    this.rawUrl = tabContext.rawURL;
    this.pageUrl = tabContext.normalURL;
    this.pageHostname = tabContext.rootHostname;
    this.pageDomain =  tabContext.rootDomain;
    this.pageScan = {};
    this.favIconUrl = '';
    this.title = '';
    this.requests = µm.PageRequestStats.factory();
    this.domains = {};
    this.allHostnamesString = ' ';
    this.requestStats.reset();
    this.distinctRequestCount = 0;
    this.perLoadAllowedRequestCount = 0;
    this.perLoadBlockedRequestCount = 0;
    this.incinerationTimer = null;
    this.scanDaemonTimer = null;
    this.mtxContentModifiedTime = 0;
    this.mtxCountModifiedTime = 0;

    // Start Page Scanning
    this.scheduleScanDaemon(1000);

    return this;
};

/******************************************************************************/

PageStore.prototype.dispose = function() {
    this.requests.dispose();
    this.rawUrl = '';
    this.pageUrl = '';
    this.pageHostname = '';
    this.pageDomain = '';
    this.pageScan = {};
    this.title = '';
    this.domains = {};
    this.allHostnamesString = ' ';

    if ( this.scanDaemonTimer !== null ) {
        clearTimeout(this.scanDaemonTimer);
        this.scanDaemonTimer = null;
    }

    if ( this.incinerationTimer !== null ) {
        clearTimeout(this.incinerationTimer);
        this.incinerationTimer = null;
    }

    if ( pageStoreJunkyard.length < 8 ) {
        pageStoreJunkyard.push(this);
    }
};

/******************************************************************************/

PageStore.prototype.recordRequest = function(type, url, block) {
    if ( !this.requests.createEntryIfNotExists(url, type, block) ) {
        return;
    }

    // Count blocked/allowed requests
    this.requestStats.record(type, block);

    // https://github.com/gorhill/httpswitchboard/issues/306
    // If it is recorded locally, record globally
    µm.requestStats.record(type, block);
    // µm.updateBadgeAsync(this.tabId);

    if ( block !== false ) {
        this.perLoadBlockedRequestCount++;
    } else {
        this.perLoadAllowedRequestCount++;
    }

    var hostname = µm.URI.hostnameFromURI(url);

    this.distinctRequestCount++;
    this.mtxCountModifiedTime = Date.now();

    if ( this.domains.hasOwnProperty(hostname) === false ) {
        this.domains[hostname] = true;
        this.allHostnamesString += hostname + ' ';
        this.mtxContentModifiedTime = Date.now();
    }

    // console.debug("pagestats.js > PageStore.recordRequest(): %o: %s @ %s", this, type, url);
};

PageStore.prototype.scheduleScanDaemon = function(delay) {
    if ( this.scanDaemonTimer !== null ) {
        clearTimeout(this.scanDaemonTimer);
    }
    µm.URI;

    var requestScheme = µm.URI.schemeFromURI(this.rawUrl);
    var maxAttempts = 50;
    var updateScan = function() {
    if (this.pageDomain != 'extensions.chrome-scheme'
     && this.pageDomain != 'behind-the-scene'
     && maxAttempts && (requestScheme === 'https' || requestScheme === 'http')
     && (this.pageScan.state === undefined || (this.pageScan.state.toUpperCase() !== "FINISHED" &&
     this.pageScan.state.toUpperCase() !== 'ABORTED')) ) {
        // console.log("Poll for scan update:", this.pageScan);
        maxAttempts--;
        // Note: Scans subdomain, but everywhere else will show as just the domain
        this.scan(this.pageHostname);
      } else {
        clearTimeout(this.scanDaemonTimer);
      }
    };

    this.scanDaemonTimer = setInterval(updateScan.bind(this), delay);
};

/******************************************************************************/

PageStore.prototype.updateScanReport = function () {
  var GRADE_CHART = { 100: 'A+', 95: 'A', 90: 'A', 85: 'A-', 80: 'B+', 75: 'B', 70: 'B', 65: 'B-', 60: 'C+', 55: 'C', 50: 'C', 45: 'C-', 40: 'D+', 35: 'D', 30: 'D', 25: 'D-', 20: 'F', 15: 'F', 10: 'F', 5: 'F', 0: 'F' }
  var adjustedScore = 115;
  for (var s in this.pageScan.scan_report) {
    if (s === 'contribute'){
      delete this.pageScan.scan_report[s];
      continue;
    }
    if (!this.pageScan.scan_report[s].pass && this.pageScan.scan_report[s].score_modifier <= -20) {
          adjustedScore += this.pageScan.scan_report[s].score_modifier;
          switch (s) {
            case 'content-security-policy':
              this.pageScan.scan_report[s].score_description_simple = 'Harmful content, or code may target you from this site';
              break;
            case 'cookies':
              if (this.pageScan.scan_report[s].score_modifier < -25) {
                this.pageScan.scan_report[s].score_description_simple = 'This service tracks information others could use to impersonate your account.'
              } else {
                this.pageScan.scan_report[s].score_description_simple = 'This service tracks you on other websites you visit';
              }
              break;
            case 'cross-origin-resource-sharing':
              this.pageScan.scan_report[s].score_description_simple = 'Other websites may harm or steal from your logged in account';
              break;
            case 'redirection':
              this.pageScan.scan_report[s].score_description_simple = 'People you share the internet with may see your data and online activity';
              break;
            case 'strict-transport-security':
              this.pageScan.scan_report[s].score_description_simple = 'This service does not promise to keep every connection secure.';
              break;
            case 'subresource-integrity':
              this.pageScan.scan_report[s].score_description_simple = 'This service does not check if it’s sending you safe code';
              break;
            case 'x-frame-options':
              this.pageScan.scan_report[s].score_description_simple = 'No protection against deceptively loading this service inside another website';
              break;
          }
      }
  }

  if (adjustedScore > 100) {
    adjustedScore = 100;
  } else if (adjustedScore < 0 ) {
    adjustedScore = 0;
  }

  this.pageScan.grade = GRADE_CHART[adjustedScore];
  this.pageScan.score = adjustedScore;
  µm.updateBadgeAsync(this.tabId);
};

PageStore.prototype.scan = function (tld) {
  var xhr = new XMLHttpRequest();
  var scan = {};
  var scanReport = {};
  var parentScope = this;


  xhr.open("POST", "https://privacy.apozy.com/api/v1/analyze?hidden=true&host=" + tld, true);
  xhr.onreadystatechange = function() {
    if (xhr.readyState == 4) {
      // JSON.parse does not evaluate the attacker's scripts.
      scan = JSON.parse(xhr.responseText);
      if (scan.error) {
        return;
      }

      xhr.open("GET", "https://privacy.apozy.com/api/v1/getScanResults?scan=" + scan.scan_id, true);
      xhr.onreadystatechange = function() {
        if (xhr.readyState == 4) {
          // JSON.parse does not evaluate the attacker's scripts.
          scanReport = JSON.parse(xhr.responseText);
          if (scanReport.error) {
            return;
          } else {
            parentScope.pageScan = scan;
            parentScope.pageScan.scan_report = scanReport;
            parentScope.updateScanReport();
          }
        }
      };
      xhr.send();
    }
  }
  xhr.send();
};

/******************************************************************************/

return {
    factory: pageStoreFactory
};

/******************************************************************************/

})();

/******************************************************************************/
