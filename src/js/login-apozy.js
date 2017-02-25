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

function changeUserSettings(name, value) {
    messager.send({
        what: 'userSettings',
        name: name,
        value: value
    });
}


function queryStringToJSON() {
    var pairs = location.search.slice(1).split('&');
    
    var result = {};
    pairs.forEach(function(pair) {
        pair = pair.split('=');
        result[pair[0]] = decodeURIComponent(pair[1] || '');
    });

    return JSON.parse(JSON.stringify(result));
}

// NOTE: runs automatically
function handleAPIKeyResponse() {
    console.log('hit');

    console.log('getting query string', location.search.slice(1));

    var queryObj = queryStringToJSON();

    console.log('queryObj', queryObj);

    if (Object.keys(queryObj).length > 0) {

        // if there is an error in the query string
        if (queryObj.error) {
            console.log("there was an error");
        // TODO: validate return object user & user.apikey w/ all necessary info, if  not redirect to /?error=true
        // if there is a empty querystring 
        } else if (queryObj[""] === "") {
            console.log("empty query string");
        } else {

            messager.send({
                what: 'updateUserApiKey',
                user: queryObj
            }, function () {
                console.log("got the callback");
                
            });
            // vAPI.storage.set({authInfo:queryObj});

            // vAPI.storage.get("authInfo", function (value) {
            //     console.log("testing getting query object", value);
            // });
        }

    }
};

/******************************************************************************/

function prepareToDie() {
}

/******************************************************************************/

uDom.onLoad(function() {
    // var onUserSettingsReceived = function(userSettings) {

    handleAPIKeyResponse();
    // };
    // messager.send({ what: 'getUserSettings' }, onUserSettingsReceived);
});

/******************************************************************************/

})();
