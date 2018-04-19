/**
 * Module dependencies.
 */

import http, { IncomingHttpHeaders } from 'http';
import express from 'express';
import path from 'path';
import fs from "fs";
import { Deferred } from "ts-deferred";
import util from 'util';

const requireGlob = require("require-glob");
const debug = require('debug')('app:server');
const createError = require('http-errors');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const logger = require('morgan');

/*
 * Define the Prom interface and it's implementations
 */

export interface IPromRoutes { [routeKey: string]: IPromMockRoute; };

export interface IPromMockRoute {
    url: string;
    method: string;
    responses: IPromResponses;
}

export type IPromResponseFactory = (req: any) => IPromResponse;
export interface IPromResponses { [responseKey: string]: IPromResponse | IPromResponseFactory; };

export interface IPromResponse {
    status: number;
    body?: any;
    headers?: { [name: string]: string }
}

export interface IProm {
    reset(): void;
    routes(routeKey: string): IPromRoute;
}

export interface IPromRoute {
    set(responseKey: string): void;
    requests: PromRequests;
    reset(): void;
}

export class PromRequest {
    constructor(
        public body: any,
        public query: any,
        public params: any,
        public headers: IncomingHttpHeaders,
        public response: IPromResponse)
        {}
}

export class PromRequests extends Array<PromRequest> {
    private deferreds: Deferred<PromRequest>[] = [];

    constructor() {
        super();
    }

    public latest(): Promise<PromRequest> {
        if (this.length !== 0) {
            return Promise.resolve(this[this.length - 1]);
        }
        
        return this._next();
    }

    public first(): Promise<PromRequest> {
        if (this.length !== 0) {
            return Promise.resolve(this[0]);
        }

        return this._next();
    }

    public add(request: PromRequest) {
        this.push(request);
        this.deferreds.forEach((deferred) => deferred.resolve(request));
        this.deferreds.length = 0;
    }

    public clear(): void {
        this.length = 0;
        this.deferreds.forEach((deferred) => deferred.reject("requests.clear() was called while waiting on a request. Be sure that all request promises have been fulfilled, before calling clear()."));
        this.deferreds.length = 0;
    }

    public next() {
        return this._next();
    }

    private _next() {
        const timeoutMs = 5000;
        const setTimeoutPromise = util.promisify(setTimeout);
        const timeout = setTimeoutPromise(timeoutMs).then(() => {
            throw Error("Timeout of " + timeoutMs + "ms expired.");
        });

        const deferred = new Deferred<PromRequest>();
        this.deferreds.push(deferred);
        return Promise.race([deferred.promise, timeout]).then((result) => {
            return result;
        });
    }
}

class PromRouteInternal implements IPromRoute {
    private _requests: PromRequests = new PromRequests();
    public activeResponseKey: string;
    public get requests(): PromRequests {
        return this._requests;
    }

    constructor(private _routeKey: string, private _route: IPromMockRoute) {}

    public set(responseKey: string) {
        const response = Object.keys(this._route.responses).find((key) => key === responseKey);
        if (!response) {
            throw Error("The reponse '" + responseKey + "' could not be found for route '" + this._routeKey +"'");
        }

        this.activeResponseKey = responseKey;
    }

    public addRequest(request: PromRequest) {
        this._requests.add(request);
    }

    public reset(): void {
        this.activeResponseKey = undefined;
        this._requests.clear();
    }

    public getResponseOrDefault(): IPromResponse | IPromResponseFactory {
        let responseKey: string;
        if (this.activeResponseKey) {
            responseKey = this.activeResponseKey;
        } else {
            responseKey = Object.keys(this._route.responses).find(k => k.toLowerCase().endsWith("default"));
        }

        return this._route.responses[responseKey];
    }
}

class Prom implements IProm {
    private _routes: { [routeKey: string]: PromRouteInternal; } = {};
    
    public routes(routeKey: string): PromRouteInternal {
        return this._routes[routeKey]
    }

    public addRoute(routeKey: string, route: IPromMockRoute) {
        this._routes[routeKey] = new PromRouteInternal(routeKey, route);
    }

    public reset(): void {
        Object.keys(this._routes).forEach((routeKey) => {
            this._routes[routeKey].reset();
        });
    }
}

/*
 * Initialize config
 */

const config = getPromConfig();

/*
 * Setup of the express Mock API.
 */

const promInternal = new Prom();
const mockRouter = setupMockRoutes(promInternal);

const app = express();

app.use(cors());
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('', mockRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err: any, req: express.Request,
  res: express.Response, next: express.NextFunction) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  throw Error(err.message);
});

/**
 * Get port from environment and store in Express.
 */

var port = normalizePort(process.env.PORT || config.prom.port);
app.set('port', port);

/**
 * Create HTTP server.
 */

const server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port);
server.on('error', onError);
server.on('listening', onListening);

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val: string) {
  var port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error: any) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  var bind = typeof port === 'string'
    ? 'Pipe ' + port
    : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  var addr = server.address();
  var bind = typeof addr === 'string'
    ? 'pipe ' + addr
    : 'port ' + addr.port;
  debug('Listening on ' + bind);
}

function setupMockRoutes(prom: Prom) {
  const router = express.Router();
  if (config.prom.mocks.length === 0) {
    throw Error("No mock routes have been provided. Use --promMocks=<,glob> to provide mock routes.");
  }

  const routeModules: any = requireGlob.sync(config.prom.mocks, {cwd: process.cwd(), reducer: flattenFiles}) || {};

  if (Object.keys(routeModules).length === 0) {
    throw Error("No modules found at " + createGlobError(process.cwd(), config.prom.mocks));
  }

  const mockRoutes: any = {};
  Object.keys(routeModules).forEach((key: string) => {
    if (routeModules[key].routes === null || typeof routeModules[key].routes !== 'object') {
        let jsonObj: string;
        try {
            jsonObj = JSON.stringify(routeModules[key])
        } catch {
            jsonObj = routeModules[key];
        }

        throw Error("Module " + key + "does not export a keyed 'routes' object. " + jsonObj);
    }

    const duplicateKey = findDuplicateSymbol(mockRoutes, routeModules[key].routes)
    if (duplicateKey) {
        throw Error("The route key " + duplicateKey + " has already been used. All route keys from every route module must be unique.");
    }

    Object.keys(routeModules[key].routes).forEach((routeKey) => {
        prom.addRoute(routeKey, routeModules[key].routes[routeKey]);
    });

    Object.assign(mockRoutes, routeModules[key].routes);
  });

  Object.keys(mockRoutes).forEach(function (routeKey) {
    const route: IPromMockRoute = mockRoutes[routeKey];
    console.log(route.method + route.url);

    (<any>router.route(route.url))[route.method.toLowerCase()](
        (req: express.Request, res: express.Response) => {

        let resData = prom.routes(routeKey).getResponseOrDefault();

        if (!resData) {
            throw Error("Could not find " +
                (req.cookies.mock ? "response with name: " + req.cookies.mock : "DEFAULT response") +
                " for url: " + route.url + " and method: " + route.method);
        }

        if (typeof(resData) === "function") {
            resData = resData(req);
        }

        prom.routes(routeKey).addRequest(new PromRequest(req.body, req.query, req.params, req.headers, resData));
        res.status(resData.status).set(resData.headers || {}).send(resData.body);
    });
  });

  return router;
}

function flattenFiles(options: any, result: any, fileObject: any, i: number, fileObjects: any[]): any {
  result[fileObject.path] = fileObject.exports;
  return result;
}

function findDuplicateSymbol(a: any, b: any): string {
    var bKeys = Object.keys(b);
    return bKeys.find((key) => a[key]);
}

function getPromConfig(): any {
    let config = readConfigFiles();

    applyConfigDefaults(config);

    let cmdArg: string = process.argv.find((a) => a.startsWith("--promMocks="));
    if (cmdArg) {
        let globArgs = cmdArg.split("=")[1].split(",");
        config.prom.mocks.push(...globArgs.map((g) => {
            return g = g.replace(/^[\'\"]+|[\'\"]+$/g, "");
        }));
    }

    return config;
}

function readConfigFiles() {
        let mergedConfig: any = {};
        // check for a protractor cli config file.
        if (process.argv.length >= 2 && fs.existsSync(process.argv[2])) {
            let config = require(path.join(process.cwd(), process.argv[2])).config;
            if (config && config.prom) {
                mergedConfig = Object.assign(config, mergedConfig);
            }
        } 
        // check if there is protractor.conf.js file.
        if (fs.existsSync('./protractor.conf.js')) {
            let config = require(path.join(process.cwd(), './protractor.conf.js')).config;
            if (config && config.prom) {
                mergedConfig = Object.assign(config, mergedConfig);
            }
        }
        // check for apiMock.conf.js
        if (fs.existsSync('./apiMock.conf.js')) {
            let config = require(path.join(process.cwd(), 'apiMock.conf.js')).config;
            if (config && config.prom) {
                mergedConfig = Object.assign(config, mergedConfig);
            }
        }

        return mergedConfig;
}

function applyConfigDefaults(config: any) {
    config.prom = config.prom || {};
    config.prom.mocks = config.prom.mocks || [];
    config.prom.port = config.prom.port || '3000';
}

function createGlobError(cwd: string , globs: string[]): string {
    let msg = "";
    globs.forEach((g) => msg += (path.join(cwd, g) + path.delimiter));
    return msg;
}

const prom: IProm = promInternal;
export default prom;
