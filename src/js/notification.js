/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014 Raymond Hill

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

/* global µMatrix, vAPI */

/******************************************************************************/
/******************************************************************************/

// Default handler

(function() {
  'use strict';

  var µm = µMatrix;

  /******************************************************************************/

  // Default is for handling all notifications

  function onNotificationClicked(domain, btnIndex) {
    vAPI.notifications.clear(domain, null);

    var onTabReady = function(tab) {
        if ( typeof tab !== 'object' ) {
            return;
        }

        // Allow examination of behind-the-scene requests
        var tabId = tab.url.lastIndexOf(vAPI.getURL('dashboard.html'), 0) !== 0 ?
            tab.id :
            vAPI.noTabId;

        µm.tMatrix.setSwitchZ(
            'matrix-off',
            domain,
            µm.tMatrix.evaluateSwitchZ('matrix-off', domain) === false
        );

        µm.forceReload(tabId);
    };

    // Get active tab
    vAPI.tabs.get(null, onTabReady);
  }

  /******************************************************************************/

  vAPI.notifications.onButtonClicked.addListener(onNotificationClicked);

  /******************************************************************************/
})();
