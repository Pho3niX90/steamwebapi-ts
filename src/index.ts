import {SteamServer} from './types/SteamServer';
import {SteamAppIdPlayers} from './types/SteamAppIdPlayers';
import {SteamUserBadge} from './types/SteamUserBadge';
import {SteamPlayerSummary} from './types/SteamPlayerSummary';
import {SteamOwnedGame} from './types/SteamOwnedGame';
import {SteamPlayedGame} from './types/SteamPlayedGame';
import {SteamPlayerBans} from './types/SteamPlayerBans';
import {SteamAchievement} from './types/SteamAchievement';
import {SteamFriend} from './types/SteamFriend';
import SteamID from 'steamid';
import dayjs from 'dayjs';
import axios from 'axios';
import Redis, {RedisOptions} from 'ioredis';

const SteamIDLib = require('steamid');
const appendQuery = require('append-query');

export class Steam {
    private readonly token: string;
    API_URL: string = 'http://api.steampowered.com/';
    _isRateLimited: boolean = false;
    _rateLimitedTimestamp: Date = new Date();
    _requestCount: number = 0;
    _requestCountLastReset: Date = new Date();
    _retryIn: number = 60;
    private readonly _timeout: number = 5000;
    private readonly redis: Redis | undefined;
    private readonly CACHE_TTL: number = 60;

    /***
     *
     * @param token your api key from Steam Web API
     * @param timeout timeout in milliseconds, defaults to 5000
     * @param newApiUrl custom api url, defaults to http://api.steampowered.com/
     * @param redisOptions
     * @param cacheTtl
     */
    constructor(token: string, timeout?: number, newApiUrl?: string, redisOptions?: RedisOptions, cacheTtl: number = 60) {
        if (timeout)
            this._timeout = timeout;
        if (newApiUrl)
            this.API_URL = newApiUrl;
        if (!token) {
            throw new Error('No token found! Supply it as argument.')
        } else {
            this.token = token;
        }
        if(redisOptions) {
            this.redis = new Redis(redisOptions);
            this.CACHE_TTL = cacheTtl;
        }
    }

    /***
     * Defaults to 60mins
     * @param retryIn in minutes
     */
    set retryIn(retryIn: number) {
        this._retryIn = retryIn;
    }

    get retryIn() {
        return this._retryIn;
    }

    get isRateLimited(): { limited: boolean, minsSince: number, minsLeft: number } {
        let minsSince = dayjs().diff(this._rateLimitedTimestamp, 'minute');
        return {limited: this._isRateLimited, minsSince, minsLeft: this.retryIn - minsSince};
    }

    private getCacheKey(url: string): string {
        return `steam_cache:${url}`;
    }

    /***
     * Resets every 24hrs
     */
    get requestCount() {
        return {count: this._requestCount, lastReset: this._requestCountLastReset.getTime()}
    }

    async request(endpoint: string, forceRefresh = false, cacheTtl?: number): Promise<any> {
        const fullUrl = appendQuery(this.API_URL + endpoint, { key: this.token });
        const cacheKey = this.getCacheKey(fullUrl);

        if (this.redis && !forceRefresh) {
            const cached = await this.redis.get(cacheKey);
            if (cached) {
                try {
                    return JSON.parse(cached);
                } catch {
                    await this.redis.del(cacheKey); // Remove corrupt data
                }
            }
        }

        const limited = this.isRateLimited;
        if (limited.limited && limited.minsSince < this.retryIn) {
            throw new Error(`Rate limited. Retrying in ${limited.minsLeft} mins`);
        }

        if (Date.now() > this._requestCountLastReset.getTime() + 86400000) {
            this._requestCount = 0;
            this._requestCountLastReset = new Date();
        }

        this._requestCount++;

        try {
            const res = await axios.get(fullUrl, { timeout: this._timeout });
            if (res.status === 200) {
                this._isRateLimited = false;
                if (this.redis)
                    await this.redis.set(cacheKey, JSON.stringify(res.data), 'EX', cacheTtl ?? this.CACHE_TTL);
                return res.data;
            } else if (res.status === 429) {
                this._isRateLimited = true;
                this._rateLimitedTimestamp = new Date();
                throw new Error(`Too many requests. Retry in ${this.retryIn} mins`);
            } else {
                throw new Error(`Steam returned status ${res.status}`);
            }
        } catch (err) {
            throw err;
        }
    }

    /***
     * Transforms a vanity SteamId into a Steam64Id
     * @param vanity
     */
    async resolveId(vanity: string): Promise<string> {
        return new Promise(async (resolve, reject) => {
            if (!vanity) {
                return reject(new Error('ID not provided.'));
            }

            if (String(vanity).match(/^7656[0-9]{13}$/i)) {
                return resolve(vanity);
            }

            let idObject: SteamID | null = null;

            try {
                idObject = new SteamIDLib(vanity);
            } catch (ignore) {
            }

            if (idObject && idObject.isValid()) {
                return resolve(idObject.getSteamID64())
            } else {
                const request = await this.request('ISteamUser/ResolveVanityURL/v0001?vanityurl=' + vanity).catch(reject);

                if (request instanceof Error || !request || !request.response || Object.keys(request.response).length === 0 || request.response.success === 42) {
                    return reject(new Error('ID not found.'));
                }
                return resolve(request.response.steamid)
            }
        });
    }

    async getNewsForApp(appid: number, count = 3, maxLength = 300) {
        return new Promise(async (resolve, reject) => {
            if (!appid) {
                return reject(new Error('AppID not provided.'));
            }
            const request = await this.request(
                `ISteamNews/GetNewsForApp/v0002?appid=${appid}&count=${count}&maxlength=${maxLength}&format=json`
            ).catch(_err => new Error('Game news not found.'))
            if (request instanceof Error || !request?.appnews) {
                return reject(new Error('Game news not found.'))
            }
            resolve(request.appnews.newsitems)
        })
    }

    async getGlobalAchievementPercentagesForApp(appid: number): Promise<SteamAchievement[]> {
        return new Promise(async (resolve, reject) => {
            if (!appid) {
                return reject(new Error('AppID not provided.'))
            }
            const request = await this.request(
                `ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002?gameid=${appid}`
            ).catch(_err => new Error('Game not found.'))
            if (request instanceof Error || !request || !request.achievementpercentages || Object.keys(request.achievementpercentages).length === 0) {
                return reject(new Error('Game not found.'))
            }
            resolve(request.achievementpercentages.achievements)
        });
    }

    async getGlobalStatsForGame(appid: number, count = 1, achievements: string[] = []): Promise<any> {
        return new Promise(async (resolve, reject) => {
            if (!appid) {
                return reject(new Error('AppID not provided.'));
            }
            if (count < 1) {
                return reject(new Error('Count must be larger than 1'));
            }

            if (achievements instanceof Error || !achievements || achievements.length === 0) {
                return reject(new Error('You must provide an array of achievement names.'));
            }

            let achievementsList = {};

            achievements.forEach((achiev, index) => {
                achievementsList = {
                    ...achievementsList,
                    [`name[${index}]`]: achiev
                }
            });

            const URLWithAchievements = appendQuery(
                `ISteamUserStats/GetGlobalStatsForGame/v0001?appid=${appid}&count=${count}`,
                achievementsList
            )
            const r = await this.request(URLWithAchievements).catch(reject)
            if (r instanceof Error || !r || !r.response || Object.keys(r.response).length === 0 || r.response.result == 20) {
                return reject(new Error('Game not found.'));
            }
            resolve(r.response.globalstats);
        });
    }

    /***
     * Accepts both vanity id and steam64Ids
     * @param id
     */
    async getPlayerSummary(id: string): Promise<SteamPlayerSummary | null> {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';

            const request = await this.request(
                `ISteamUser/GetPlayerSummaries/v0002?steamids=${id}`
            ).catch(reject);

            if (request instanceof Error || !request || !request?.response?.players?.length) {
                return reject(new Error('STEAM_ERROR'))
            }

            if (request?.response?.players && request?.response?.players?.length > 0)
                resolve(request.response?.players.shift())
            else {
                reject(new Error('STEAM_ERROR'));
            }
        });
    }

    /***
     * Accepts ONLY steam64Ids
     * @param ids
     */
    async getPlayersSummary(ids: string[]): Promise<SteamPlayerSummary[]> {
        return new Promise(async (resolve, reject) => {
            if (!ids || ids.length < 1) {
                return reject(new Error('IDs not provided.'));
            }
            const request = await this.request(
                `ISteamUser/GetPlayerSummaries/v0002?steamids=${ids.join(',')}`
            ).catch(reject)
            if (request instanceof Error || !request) {
                return reject(new Error('STEAM_ERROR'))
            }
            resolve(request.response.players);
        })
    }

    async getOwnedGames(id: string, include_free_games = false, include_appinfo = false): Promise<SteamOwnedGame[]> {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            const request = await this.request(
                appendQuery(
                    `IPlayerService/GetOwnedGames/v1?steamid=${id}&format=json&include_played_free_games=${
                        include_free_games ? 1 : 0
                    }&include_appinfo=${include_appinfo ? 1 : 0}`,
                    {}
                )
            ).catch(reject)
            if (request instanceof Error || !request) {
                return reject(new Error('STEAM_ERROR'))
            }
            resolve(request.response.games);
        });
    }

    async getRecentlyPlayedGames(id: string): Promise<SteamPlayedGame[]> {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            const request = await this.request(
                `IPlayerService/GetRecentlyPlayedGames/v0001?steamid=${id}&format=json`
            ).catch(reject);
            if (request instanceof Error || !request) {
                return reject(new Error('STEAM_ERROR'))
            }
            resolve(request.response.games);
        });
    }

    async getPlayerBans(id: string): Promise<SteamPlayerBans> {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            const request = await this.request(
                `ISteamUser/GetPlayerBans/v1?steamids=${id}`
            ).catch(reject)
            if (request instanceof Error || !request || !request?.players) {
                return reject(new Error('STEAM_ERROR'));
            }
            resolve(request.players.shift());
        });
    }

    /***
     * Accepts ONLY steam64Ids
     * @param ids
     */
    async getPlayersBans(ids: string[]): Promise<SteamPlayerBans[]> {
        return new Promise(async (resolve, reject) => {
            const request = await this.request(
                `ISteamUser/GetPlayerBans/v1?steamids=${ids.join(',')}`
            ).catch(reject)
            if (request instanceof Error || !request || !request?.players) {
                return reject(new Error('STEAM_ERROR'));
            }
            resolve(request.players);
        });
    }

    async getPlayerAchievements(id: string, appid: number, onlyAchieved = false) {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            if (!appid) {
                return reject(new Error('AppID not provided.'));
            }
            const request = await this.request(
                `ISteamUserStats/GetPlayerAchievements/v0001?steamid=${id}&appid=${appid}`
            ).catch(_err => new Error('Profile not found or private'))
            if (onlyAchieved) {
                resolve(request.playerstats.achievements.filter(
                    achievement => achievement.achieved === 1
                ))
            }
            if (!request || !request?.playerstats?.success)
                return reject(new Error('Profile not found or private'));
            resolve(request.playerstats.achievements);
        })
    }

    async getUserStatsForGame(id: string, appid) {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            if (!appid) {
                reject(new Error('AppID not provided.'));
            }
            this.request(`ISteamUserStats/GetUserStatsForGame/v0002?steamid=${id}&appid=${appid}`)
                .then(response => {
                    resolve(response.playerstats.stats)
                })
                .catch(() => {
                    reject(new Error('Profile not found or private'))
                })
        })
    }

    async getFriendList(id: string): Promise<SteamFriend[]> {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            const request = await this.request(
                `ISteamUser/GetFriendList/v0001?steamid=${id}&relationship=friend`
            ).catch(reject)
            if (request instanceof Error || !request?.friendslist) return reject(new Error('Profile not found or private'));
            resolve(request.friendslist.friends);
        });
    }

    /***
     * Gets the players steam level, returns -1 if private or not found.
     * @param id
     */
    async getUserLevel(id: string): Promise<number> {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            const request = await this.request(
                `IPlayerService/GetSteamLevel/v1?steamid=${id}`
            ).catch(reject)

            if (request instanceof Error || !request || !request.response || Object.keys(request.response).length === 0)
                return resolve(-1);

            resolve(request?.response?.player_level ?? -1);
        });
    }

    /***
     * Returns steamid of lender if sharing.
     * @param id
     * @param appid
     */
    async isPlayingSharedGame(id: string, appid: number): Promise<string> {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            if (!appid) {
                return reject(new Error('AppID not provided.'));
            }
            const request = await this.request(
                `IPlayerService/IsPlayingSharedGame/v0001?steamid=${id}&appid_playing=${appid}`
            ).catch(reject)
            if (request instanceof Error || !request || !request?.response?.success)
                return reject(new Error('Profile not found or private'))
            resolve(request.response.lender_steamid)
        })
    }

    async getSchemaForGame(appid: number) {
        return new Promise(async (resolve, reject) => {
            if (!appid) {
                return reject(new Error('AppID not provided.'))
            }
            const {game} = await this.request(
                `ISteamUserStats/GetSchemaForGame/v2?appid=${appid}`
            ).catch(reject)
            return resolve(game);
        })
    }

    async getAppList() {
        const {applist} = await this.request('ISteamApps/GetAppList/v2')
        return applist.apps
    }

    async getAppInfo(appid: number) {
        return new Promise(async (resolve, reject) => {
            if (!appid) {
                return reject(new Error('AppID not provided.'));
            }
            const app = await axios.request({
                url: 'http://store.steampowered.com/api/appdetails?appids=' + appid,
                timeout: this._timeout
            }).then(res => res.data).catch(reject)
            if (!app[appid].success) {
                return reject(new Error('App not found.'))
            }
            resolve(app[appid]);
        });
    }

    async getUserBadges(id: string): Promise<SteamUserBadge[]> {
        return new Promise(async (resolve, reject) => {
            id = await this.resolveId(id).catch(reject) || '';
            const request = await this.request(
                `IPlayerService/GetBadges/v1?steamid=${id}`
            ).catch(reject);

            if (request instanceof Error || !request || Object.keys(request.response).length == 0) {
                return reject(new Error('Profile not found or private'));
            }
            resolve(request.response.badges);
        });
    }

    async getNumberOfCurrentPlayers(appid: number): Promise<SteamAppIdPlayers> {
        return new Promise(async (resolve, reject) => {
            if (!appid) {
                reject(new Error('AppID not provided.'))
            }

            const request = await this.request(
                `ISteamUserStats/GetNumberOfCurrentPlayers/v1?appid=${appid}`
            ).catch(reject)

            if (request instanceof Error || !request) {
                return reject(new Error('STEAM_ERROR'))
            }

            resolve(<SteamAppIdPlayers>request.response);
        })
    }

    /***
     * See https://developer.valvesoftware.com/wiki/Master_Server_Query_Protocol#Filter for filter info
     * @param filter
     * @param limit
     */
    async getServerList(filter: string, limit?: number): Promise<SteamServer[]> {
        return new Promise(async (resolve, reject) => {
            if (!filter || filter.length === 0) {
                return reject(new Error('Filter not provided.'));
            }

            let url = `IGameServersService/GetServerList/v1?filter=${filter}`;
            if (limit) {
                url = appendQuery(url, {limit: limit});
            }

            const request = await this.request(url).catch(reject);
            if (request instanceof Error || !request || Object.keys(request.response).length === 0 || !request.response.servers) {
                return reject(new Error('Response from steam invalid.'));
            }

            resolve(request.response.servers as SteamServer[]);
        });
    }
}
