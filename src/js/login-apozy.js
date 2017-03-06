/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014  Raymond Hill

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

/* global vAPI, uDom */
/* jshint multistr: true */

/******************************************************************************/

(function() {

'use strict';

/******************************************************************************/

var messager = vAPI.messaging.channel('options.js');

var cachedUserSettings = {};

/******************************************************************************/


function queryStringToJSON() {
    var pairs = location.search.slice(1).split('&');
    
    var result = {};
    pairs.forEach(function(pair) {
        pair = pair.split('=');
        result[pair[0]] = decodeURIComponent(pair[1] || '');
    });

    return JSON.parse(JSON.stringify(result));
}

// NOTE: runs onLoad
function handleURLQuerystring() {
    try {
        var queryObj = queryStringToJSON();
    } catch (e) {
        // TODO: @ejustice implement error view
        console.log("Malformed querystring", e);
        return;
    }

    if (queryObj !== undefined && Object.keys(queryObj).length > 0) {

        // if there is an error in the query string
        if (queryObj.error) {
            // TODO: @ejustice implement error view 
            console.log("Querystring indicated error.");

        // if there is a empty querystring, do nothing
        } else if (queryObj[""] === "") {
            // Do nothing
        } else if (queryObj.logout) {
            messager.send({
                what: 'logout'
            });
        // otherwise, if there is a valid apikey querystring
        } else if (queryObj.email && queryObj.id && queryObj.secret) {
            messager.send({
                what: 'setUserApiKey',
                user: queryObj
            }, function (info) {
                // Do nothing                
            });
        } else {
            // Do nothing 
        }

    }
};

/******************************************************************************/

function prepareToDie() {}

/******************************************************************************/

uDom.onLoad(function() {
    handleURLQuerystring();
});

/******************************************************************************/

})();
