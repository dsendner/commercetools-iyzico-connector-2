import { Injectable } from "@nestjs/common";
import { Env, envSchema } from "./env.schema";

@Injectable()
export class AppConfigService {
    private readonly env: Env;

    constructor(){
        this.env = envSchema.parse(process.env);
    }

    get<K extends keyof Env>(key: K): Env[K] {
        return this.env[key];
    }
}