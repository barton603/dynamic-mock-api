import { IPromRoutes } from "./../../build/lib";
export const routes: IPromRoutes = {
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
}