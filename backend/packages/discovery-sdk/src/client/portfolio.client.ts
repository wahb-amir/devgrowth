import { http } from "./http";
import { getAndValidateHostname } from "../validators/portfolio";
import { config } from "../config"

const BASE = config.portfolio.baseUrl;


export const portfolioClient = {
    getPortfolio: (hostname:string) => {
        const safeHostname = getAndValidateHostname(hostname);
        return http(`${BASE}/portfolio/${safeHostname}`);
    }
};