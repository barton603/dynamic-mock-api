# dynamic-mock-api
A Node module for creating a dynamic mock (express) API on the fly. Allows users to verify requests to the API. Designed for use with browser testing and protrator in particular. Using a mock API removes the need to inject mocks into UI code during selenium based testing. The latency of making a call to a localhost API is small enough in comparison to Selenium tasks and page load times to prevent it from becoming a testing bottleneck.

## Install
```
npm install dynamic-mock-api
```
## Usage
(using mocha, chai, and axios packages)
Write mock responses.
```javascript
// users.mock.js
exports.routes = {
    USERS_POST: {
        url: "/api/users/add",
        method: "post",
        responses: {
            DEFAULT: {
                status: 200,
                body: {
                    name: "Alice",
                    id: 1
                }
            },
        }
    }
};
```
Write tests.
```javascript
// users.spec.js
var mocha = require("mocha");
var chai = require("chai");
var axios = require("axios");
var prom = require("dynamic-mock-api");

describe("Basic test", () => {
    it("Should work", async () => {
        const tokenEndpoint = prom.routes("USERS_POST");
        
        await axios.post("http://localhost:8080/api/users/add", { name: "user" });
        const request = await tokenEndpoint.requests.latest();

        chai.expect(request.body.name).to.equal("user");
        chai.expect(request.response.body.id).to.equal(1);
    });
});
```
Write a apiMock.conf.js.
```javascript
// apiMock.conf.js
module.exports.config = {
    prom: {
        mocks: [
            'users.spec.js'
        ],
        port: 8080
    }
}
```
Run test.
```
mocha --exit
```
Thats it!
## Mocks
It is highly recommend that you write the mock files using typescript for better compile time validation.
Mock files must satisfy the following structure.
```javascript
import { IPromRoutes } from "./../../build/lib";
export const routes: IPromRoutes = // Helps ensure the mock conforms to the proper structure.
{
    USERS_POST: // The routeKey. Must contain a unique url/method combination. A module can contain any number of routeKeys.
    {
        url: "/api/users/add", // url passed to express.Router().route(url)[method](...)
        method: "post", // method passed to express.Router().route(url)[method](...)
        responses: {
            DEFAULT: // responseKey. Use DEFAULT to make it the default response.
            {
                status: 200, // status code.
                body: {}, // The body. Passed to express.req.send(body).
                headers: {} // Passed to express.req.set(headers)
            },
            NOT_AUTHORIZED: // Can also be a function which takes the express req object and returns a response object.
            (req) => {
                return {
                    status: 401,
                    body: {
                        error: req.query.id + " is not authorized"
                    }
                }
            }
        }
    }
    // More routeKey s...
}
```
## Config
The config module may be one of the following.
* A module file named apiMock.conf.js. (must be in executing directory)
* Combined with the protractor.conf.js module. (must be in executing directory)
* Combined with the arbitrarily named file passed to the protractor cli, containing a valid protractor config module. Ie. ```protractor conf.js```
all modules must be named _config_.
### config.prom.mocks string[]
An array of globs which specifies where to load the mock files from. All files in the glob must contain a valid mock module.
### config.prom.port number | string
The port on which mock api will run. Default is 3000.
## API
### prom.routes(routeKey)
* routeKey _\<string>_
returns an object which represents the mock route selected with _routekey_
### prom.routes(routeKey).set(responseKey)
* responseKey _\<string>_
Uses responseKey to set the response for the selected route.
### prom.routes(routeKey).requests.latest(): Promise\<PromRequest>
returns a promise which resolves to the most recently received request on the selected route. If no requests have been received, the promise will not resolve until a request is received.
### prom.routes(routeKey).requests.first(): Promise\<PromRequest>
returns a promise which resolves to the first received request on the selected route. If no requests have been received, the promise will not resolve until a request is received.
### prom.routes(routeKey).requests.next(): Promise\<PromRequest>
returns a promise which resolves to the next request to be received on the selected route.
### prom.routes(routeKey).requests.all: PromRequest[]
A getter which returns an array of all requests received on the selected route. The requests are ordered from least to most recent.
### prom.reset()
Resets the api to its initial state. Removes all stored requests. Should be called before each test.
### PromRequest
The PromRquest object in typescript
```javascript
PromRequest: {
  body: any,
  headers: express.IncomingHttpHeaders,
  params: any,
  query: any,
  response // The response generated by your mock file.
}
```
