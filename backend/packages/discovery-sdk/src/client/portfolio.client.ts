import { http } from "./http";
import { validateAndCleanGitHubUsername } from "../validators/github";
import { config } from "../config"

const BASE = config.portfolio.baseUrl;


export const portfolioClient = {
    getPortfolio: (hostname:string) => {
        const safeHostname = validateAndCleanGitHubUsername(hostname);
        return http(`${BASE}/portfolio/${safeHostname}`);
    }
};