import util from "util";
import mocha from "mocha";
import chai from "chai";
import axios from "axios";
import prom from "./../build/lib";

describe("Basic test", () => {
    it("Should work", async () => {
        const tokenEndpoint = prom.routes("USERS_POST");
        
        const nextPromise = tokenEndpoint.requests.next();
        await axios.post("http://localhost:3000/api/users/add", { name: "user" });
        const request = await nextPromise;

        chai.expect(request.body.name).to.equal("user");
        chai.expect(request.response.body.id).to.equal(1);
    });
});