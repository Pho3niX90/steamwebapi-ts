import axios from 'axios';
import {Steam} from '../src';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

const STEAM64 = '76561198007433923';
const STEAM64_B = '76561199044451528';
const APP_ID = 252490;

type FakeRedis = {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
};

function createRedisMock(overrides: Partial<FakeRedis> = {}): FakeRedis {
    return {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
        ...overrides,
    };
}

function mockGetOk(data: unknown) {
    mockedAxios.get.mockResolvedValue({status: 200, data});
}

describe('Steam unit tests', () => {
    let api: Steam;

    beforeEach(() => {
        jest.clearAllMocks();
        api = new Steam('test-token', 1000);
    });

    describe('constructor', () => {
        it('throws without token', () => {
            expect(() => new Steam('' as any)).toThrow('No token found! Supply it as argument.');
            expect(() => new (Steam as any)()).toThrow('No token found! Supply it as argument.');
        });

        it('applies timeout, api url, redis and cache ttl', () => {
            const redis = createRedisMock();
            const steam = new Steam('tok', 12345, 'https://example.com/', redis as any, 120);
            expect(steam.API_URL).toBe('https://example.com/');
            expect((steam as any)._timeout).toBe(12345);
            expect((steam as any).CACHE_TTL).toBe(120);
            expect((steam as any).redis).toBe(redis);
        });

        it('keeps defaults when optional args omitted', () => {
            const steam = new Steam('tok');
            expect(steam.API_URL).toBe('http://api.steampowered.com/');
            expect((steam as any)._timeout).toBe(5000);
            expect((steam as any).redis).toBeUndefined();
            expect((steam as any).CACHE_TTL).toBe(60);
        });
    });

    describe('retryIn / isRateLimited / requestCount', () => {
        it('gets and sets retryIn', () => {
            expect(api.retryIn).toBe(60);
            api.retryIn = 30;
            expect(api.retryIn).toBe(30);
        });

        it('reports rate limit state', () => {
            api._isRateLimited = true;
            api._rateLimitedTimestamp = new Date();
            const state = api.isRateLimited;
            expect(state.limited).toBe(true);
            expect(state.minsSince).toBe(0);
            expect(state.minsLeft).toBe(60);
        });

        it('returns requestCount', () => {
            const {count, lastReset} = api.requestCount;
            expect(count).toBe(0);
            expect(typeof lastReset).toBe('number');
        });
    });

    describe('request()', () => {
        it('returns data on 200 without redis', async () => {
            mockGetOk({ok: true});
            await expect(api.request('endpoint')).resolves.toEqual({ok: true});
            expect(api.requestCount.count).toBe(1);
            expect(api._isRateLimited).toBe(false);
        });

        it('returns cached value from redis', async () => {
            const redis = createRedisMock({
                get: jest.fn().mockResolvedValue(JSON.stringify({cached: 1})),
            });
            const steam = new Steam('tok', 1000, undefined, redis as any);
            await expect(steam.request('endpoint')).resolves.toEqual({cached: 1});
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('deletes corrupt cache and refetches', async () => {
            const redis = createRedisMock({
                get: jest.fn().mockResolvedValue('{bad-json'),
            });
            const steam = new Steam('tok', 1000, undefined, redis as any);
            mockGetOk({fresh: true});
            await expect(steam.request('endpoint')).resolves.toEqual({fresh: true});
            expect(redis.del).toHaveBeenCalled();
            expect(redis.set).toHaveBeenCalled();
        });

        it('skips cache when forceRefresh is true', async () => {
            const redis = createRedisMock({
                get: jest.fn().mockResolvedValue(JSON.stringify({cached: 1})),
            });
            const steam = new Steam('tok', 1000, undefined, redis as any, 90);
            mockGetOk({fresh: true});
            await expect(steam.request('endpoint', true, 15)).resolves.toEqual({fresh: true});
            expect(redis.get).not.toHaveBeenCalled();
            expect(redis.set).toHaveBeenCalledWith(
                expect.stringContaining('steam_cache:'),
                JSON.stringify({fresh: true}),
                'EX',
                15
            );
        });

        it('uses default CACHE_TTL when cacheTtl omitted', async () => {
            const redis = createRedisMock();
            const steam = new Steam('tok', 1000, undefined, redis as any, 77);
            mockGetOk({a: 1});
            await steam.request('endpoint');
            expect(redis.set).toHaveBeenCalledWith(
                expect.any(String),
                JSON.stringify({a: 1}),
                'EX',
                77
            );
        });

        it('throws when rate limited within retry window', async () => {
            api._isRateLimited = true;
            api._rateLimitedTimestamp = new Date();
            api.retryIn = 60;
            await expect(api.request('endpoint')).rejects.toThrow(/Rate limited\. Retrying in/);
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('allows request after retry window elapsed', async () => {
            api._isRateLimited = true;
            api._rateLimitedTimestamp = new Date(Date.now() - 61 * 60 * 1000);
            api.retryIn = 60;
            mockGetOk({ok: 1});
            await expect(api.request('endpoint')).resolves.toEqual({ok: 1});
            expect(api._isRateLimited).toBe(false);
        });

        it('resets request count after 24 hours', async () => {
            api._requestCount = 5;
            api._requestCountLastReset = new Date(Date.now() - 86500000);
            mockGetOk({ok: 1});
            await api.request('endpoint');
            expect(api.requestCount.count).toBe(1);
        });

        it('handles 429 status', async () => {
            mockedAxios.get.mockResolvedValue({status: 429, data: {}});
            await expect(api.request('endpoint')).rejects.toThrow(/Too many requests\. Retry in/);
            expect(api._isRateLimited).toBe(true);
        });

        it('handles non-200 non-429 status', async () => {
            mockedAxios.get.mockResolvedValue({status: 500, data: {}});
            await expect(api.request('endpoint')).rejects.toThrow('Steam returned status 500');
        });

        it('rethrows axios errors', async () => {
            mockedAxios.get.mockRejectedValue(new Error('network'));
            await expect(api.request('endpoint')).rejects.toThrow('network');
        });

        it('does nothing special when redis cache miss', async () => {
            const redis = createRedisMock({get: jest.fn().mockResolvedValue(null)});
            const steam = new Steam('tok', 1000, undefined, redis as any);
            mockGetOk({ok: 1});
            await expect(steam.request('endpoint')).resolves.toEqual({ok: 1});
        });
    });

    describe('resolveId()', () => {
        it('rejects empty id', async () => {
            await expect(api.resolveId('')).rejects.toThrow('ID not provided.');
        });

        it('passthrough steam64', async () => {
            await expect(api.resolveId(STEAM64)).resolves.toBe(STEAM64);
        });

        it('converts steam2 and steam3', async () => {
            await expect(api.resolveId('STEAM_0:1:23584097')).resolves.toBe(STEAM64);
            await expect(api.resolveId('[U:1:47168195]')).resolves.toBe(STEAM64);
        });

        it('resolves vanity via api', async () => {
            mockGetOk({response: {success: 1, steamid: STEAM64}});
            await expect(api.resolveId('Pho3niX90')).resolves.toBe(STEAM64);
        });

        it('rejects when vanity not found (success 42)', async () => {
            mockGetOk({response: {success: 42}});
            await expect(api.resolveId('null/*-/-*')).rejects.toThrow('ID not found.');
        });

        it('rejects when vanity response empty', async () => {
            mockGetOk({response: {}});
            await expect(api.resolveId('missinguser')).rejects.toThrow('ID not found.');
        });

        it('rejects when vanity request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.resolveId('missinguser')).rejects.toThrow('fail');
        });
    });

    describe('getNewsForApp()', () => {
        it('returns news items', async () => {
            mockGetOk({appnews: {newsitems: [{title: 'n'}]}});
            await expect(api.getNewsForApp(APP_ID)).resolves.toEqual([{title: 'n'}]);
        });

        it('rejects missing appid', async () => {
            await expect(api.getNewsForApp(0)).rejects.toThrow('AppID not provided.');
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getNewsForApp(APP_ID)).rejects.toThrow('Game news not found.');
        });

        it('rejects when appnews missing', async () => {
            mockGetOk({});
            await expect(api.getNewsForApp(APP_ID)).rejects.toThrow('Game news not found.');
        });
    });

    describe('getGlobalAchievementPercentagesForApp()', () => {
        it('returns achievements', async () => {
            mockGetOk({achievementpercentages: {achievements: [{name: 'a', percent: 1}]}});
            await expect(api.getGlobalAchievementPercentagesForApp(APP_ID)).resolves.toEqual([
                {name: 'a', percent: 1},
            ]);
        });

        it('rejects missing appid', async () => {
            await expect(api.getGlobalAchievementPercentagesForApp(0)).rejects.toThrow(
                'AppID not provided.'
            );
        });

        it('rejects on request failure', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getGlobalAchievementPercentagesForApp(APP_ID)).rejects.toThrow(
                'Game not found.'
            );
        });

        it('rejects empty achievementpercentages', async () => {
            mockGetOk({achievementpercentages: {}});
            await expect(api.getGlobalAchievementPercentagesForApp(APP_ID)).rejects.toThrow(
                'Game not found.'
            );
        });
    });

    describe('getGlobalStatsForGame()', () => {
        it('returns globalstats', async () => {
            mockGetOk({response: {globalstats: {bullet_fired: {total: '1'}}}});
            await expect(
                api.getGlobalStatsForGame(APP_ID, 2, ['bullet_fired', 'kill_chicken'])
            ).resolves.toEqual({bullet_fired: {total: '1'}});
        });

        it('rejects missing appid', async () => {
            await expect(api.getGlobalStatsForGame(0, 1, ['a'])).rejects.toThrow(
                'AppID not provided.'
            );
        });

        it('rejects count < 1', async () => {
            await expect(api.getGlobalStatsForGame(APP_ID, 0, ['a'])).rejects.toThrow(
                'Count must be larger than 1'
            );
        });

        it('rejects empty achievements', async () => {
            await expect(api.getGlobalStatsForGame(APP_ID, 1, [])).rejects.toThrow(
                'You must provide an array of achievement names.'
            );
        });

        it('rejects achievements passed as Error', async () => {
            await expect(
                api.getGlobalStatsForGame(APP_ID, 1, new Error('x') as any)
            ).rejects.toThrow('You must provide an array of achievement names.');
        });

        it('rejects falsy achievements array', async () => {
            await expect(api.getGlobalStatsForGame(APP_ID, 1, null as any)).rejects.toThrow(
                'You must provide an array of achievement names.'
            );
        });

        it('rejects when steam result is 20', async () => {
            mockGetOk({response: {result: 20}});
            await expect(api.getGlobalStatsForGame(APP_ID, 1, ['a'])).rejects.toThrow(
                'Game not found.'
            );
        });

        it('rejects empty response', async () => {
            mockGetOk({response: {}});
            await expect(api.getGlobalStatsForGame(APP_ID, 1, ['a'])).rejects.toThrow(
                'Game not found.'
            );
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getGlobalStatsForGame(APP_ID, 1, ['a'])).rejects.toThrow('fail');
        });
    });

    describe('getPlayerSummary()', () => {
        it('returns player', async () => {
            mockGetOk({response: {players: [{steamid: STEAM64, personaname: 'A'}]}});
            await expect(api.getPlayerSummary(STEAM64)).resolves.toEqual({
                steamid: STEAM64,
                personaname: 'A',
            });
        });

        it('rejects when no players', async () => {
            mockGetOk({response: {players: []}});
            await expect(api.getPlayerSummary(STEAM64)).rejects.toThrow('STEAM_ERROR');
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getPlayerSummary(STEAM64)).rejects.toThrow('fail');
        });

        it('rejects when resolveId fails', async () => {
            await expect(api.getPlayerSummary('')).rejects.toThrow('ID not provided.');
        });
    });

    describe('getPlayersSummary()', () => {
        it('returns players', async () => {
            mockGetOk({
                response: {
                    players: [
                        {steamid: STEAM64},
                        {steamid: STEAM64_B},
                    ],
                },
            });
            await expect(api.getPlayersSummary([STEAM64, STEAM64_B])).resolves.toHaveLength(2);
        });

        it('rejects missing ids', async () => {
            await expect(api.getPlayersSummary([])).rejects.toThrow('IDs not provided.');
            await expect(api.getPlayersSummary(null as any)).rejects.toThrow('IDs not provided.');
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getPlayersSummary([STEAM64])).rejects.toThrow('fail');
        });

        it('rejects when request returns falsy', async () => {
            mockGetOk(null);
            await expect(api.getPlayersSummary([STEAM64])).rejects.toThrow('STEAM_ERROR');
        });
    });

    describe('getOwnedGames()', () => {
        it('returns games with flags', async () => {
            mockGetOk({response: {games: [{appid: APP_ID}]}});
            await expect(api.getOwnedGames(STEAM64, true, true)).resolves.toEqual([
                {appid: APP_ID},
            ]);
        });

        it('returns games with defaults', async () => {
            mockGetOk({response: {games: [{appid: 1}]}});
            await expect(api.getOwnedGames(STEAM64)).resolves.toEqual([{appid: 1}]);
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getOwnedGames(STEAM64)).rejects.toThrow('fail');
        });

        it('rejects falsy response', async () => {
            mockGetOk(null);
            await expect(api.getOwnedGames(STEAM64)).rejects.toThrow('STEAM_ERROR');
        });
    });

    describe('getRecentlyPlayedGames()', () => {
        it('returns games', async () => {
            mockGetOk({response: {games: [{appid: APP_ID, playtime_2weeks: 10}]}});
            await expect(api.getRecentlyPlayedGames(STEAM64)).resolves.toEqual([
                {appid: APP_ID, playtime_2weeks: 10},
            ]);
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getRecentlyPlayedGames(STEAM64)).rejects.toThrow('fail');
        });

        it('rejects falsy response', async () => {
            mockGetOk(null);
            await expect(api.getRecentlyPlayedGames(STEAM64)).rejects.toThrow('STEAM_ERROR');
        });
    });

    describe('getPlayerBans()', () => {
        it('returns bans', async () => {
            mockGetOk({
                players: [
                    {
                        SteamId: STEAM64,
                        CommunityBanned: false,
                        VACBanned: false,
                        NumberOfVACBans: 0,
                        DaysSinceLastBan: 0,
                        NumberOfGameBans: 0,
                        EconomyBan: 'none',
                    },
                ],
            });
            await expect(api.getPlayerBans(STEAM64)).resolves.toMatchObject({SteamId: STEAM64});
        });

        it('rejects when players missing', async () => {
            mockGetOk({});
            await expect(api.getPlayerBans(STEAM64)).rejects.toThrow('STEAM_ERROR');
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getPlayerBans(STEAM64)).rejects.toThrow('fail');
        });
    });

    describe('getPlayersBans()', () => {
        it('returns bans list', async () => {
            mockGetOk({players: [{SteamId: STEAM64}, {SteamId: STEAM64_B}]});
            await expect(api.getPlayersBans([STEAM64, STEAM64_B])).resolves.toHaveLength(2);
        });

        it('rejects when players missing', async () => {
            mockGetOk({});
            await expect(api.getPlayersBans([STEAM64])).rejects.toThrow('STEAM_ERROR');
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getPlayersBans([STEAM64])).rejects.toThrow('fail');
        });
    });

    describe('getPlayerAchievements()', () => {
        const achievements = [
            {apiname: 'a', achieved: 1},
            {apiname: 'b', achieved: 0},
        ];

        it('returns all achievements', async () => {
            mockGetOk({playerstats: {success: true, achievements}});
            await expect(api.getPlayerAchievements(STEAM64, APP_ID)).resolves.toEqual(
                achievements
            );
        });

        it('returns only achieved when flagged', async () => {
            mockGetOk({playerstats: {success: true, achievements}});
            await expect(api.getPlayerAchievements(STEAM64, APP_ID, true)).resolves.toEqual([
                {apiname: 'a', achieved: 1},
            ]);
        });

        it('rejects missing appid', async () => {
            await expect(api.getPlayerAchievements(STEAM64, 0)).rejects.toThrow(
                'AppID not provided.'
            );
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getPlayerAchievements(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
        });

        it('rejects when success false', async () => {
            mockGetOk({playerstats: {success: false}});
            await expect(api.getPlayerAchievements(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
        });
    });

    describe('getUserStatsForGame()', () => {
        it('returns stats', async () => {
            mockGetOk({playerstats: {stats: [{name: 'kills', value: 1}]}});
            await expect(api.getUserStatsForGame(STEAM64, APP_ID)).resolves.toEqual([
                {name: 'kills', value: 1},
            ]);
        });

        it('rejects missing appid', async () => {
            // method rejects but still fires request; mock to avoid unhandled rejection noise
            mockedAxios.get.mockRejectedValue(new Error('skip'));
            await expect(api.getUserStatsForGame(STEAM64, null)).rejects.toThrow(
                'AppID not provided.'
            );
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getUserStatsForGame(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
        });
    });

    describe('getFriendList()', () => {
        it('returns friends', async () => {
            mockGetOk({friendslist: {friends: [{steamid: STEAM64_B}]}});
            await expect(api.getFriendList(STEAM64)).resolves.toEqual([{steamid: STEAM64_B}]);
        });

        it('rejects when friendslist missing', async () => {
            mockGetOk({});
            await expect(api.getFriendList(STEAM64)).rejects.toThrow(
                'Profile not found or private'
            );
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getFriendList(STEAM64)).rejects.toThrow('fail');
        });
    });

    describe('getUserLevel()', () => {
        it('returns level', async () => {
            mockGetOk({response: {player_level: 42}});
            await expect(api.getUserLevel(STEAM64)).resolves.toBe(42);
        });

        it('returns -1 for empty response', async () => {
            mockGetOk({response: {}});
            await expect(api.getUserLevel(STEAM64)).resolves.toBe(-1);
        });

        it('returns -1 when player_level missing', async () => {
            mockGetOk({response: {something: 1}});
            await expect(api.getUserLevel(STEAM64)).resolves.toBe(-1);
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getUserLevel(STEAM64)).rejects.toThrow('fail');
        });
    });

    describe('isPlayingSharedGame()', () => {
        it('returns lender steamid', async () => {
            mockGetOk({response: {success: 1, lender_steamid: '0'}});
            await expect(api.isPlayingSharedGame(STEAM64, APP_ID)).resolves.toBe('0');
        });

        it('rejects missing appid', async () => {
            await expect(api.isPlayingSharedGame(STEAM64, 0)).rejects.toThrow(
                'AppID not provided.'
            );
        });

        it('rejects when unsuccessful', async () => {
            mockGetOk({response: {}});
            await expect(api.isPlayingSharedGame(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.isPlayingSharedGame(STEAM64, APP_ID)).rejects.toThrow('fail');
        });
    });

    describe('getSchemaForGame()', () => {
        it('returns game schema', async () => {
            mockGetOk({game: {gameName: 'Rust'}});
            await expect(api.getSchemaForGame(APP_ID)).resolves.toEqual({gameName: 'Rust'});
        });

        it('rejects missing appid', async () => {
            await expect(api.getSchemaForGame(0)).rejects.toThrow('AppID not provided.');
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getSchemaForGame(APP_ID)).rejects.toThrow('fail');
        });
    });

    describe('getAppList()', () => {
        it('returns apps', async () => {
            mockGetOk({applist: {apps: [{appid: 1, name: 'x'}]}});
            await expect(api.getAppList()).resolves.toEqual([{appid: 1, name: 'x'}]);
        });
    });

    describe('getAppInfo()', () => {
        it('returns app details', async () => {
            mockedAxios.request.mockResolvedValue({
                data: {[APP_ID]: {success: true, data: {name: 'Rust'}}},
            });
            await expect(api.getAppInfo(APP_ID)).resolves.toEqual({
                success: true,
                data: {name: 'Rust'},
            });
        });

        it('rejects missing appid', async () => {
            await expect(api.getAppInfo(0)).rejects.toThrow('AppID not provided.');
        });

        it('rejects unsuccessful app', async () => {
            mockedAxios.request.mockResolvedValue({
                data: {[APP_ID]: {success: false}},
            });
            await expect(api.getAppInfo(APP_ID)).rejects.toThrow('App not found.');
        });

        it('rejects when request fails', async () => {
            mockedAxios.request.mockRejectedValue(new Error('fail'));
            await expect(api.getAppInfo(APP_ID)).rejects.toThrow('fail');
        });
    });

    describe('getUserBadges()', () => {
        it('returns badges', async () => {
            mockGetOk({response: {badges: [{badgeid: 1}]}});
            await expect(api.getUserBadges(STEAM64)).resolves.toEqual([{badgeid: 1}]);
        });

        it('rejects empty response', async () => {
            mockGetOk({response: {}});
            await expect(api.getUserBadges(STEAM64)).rejects.toThrow(
                'Profile not found or private'
            );
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getUserBadges(STEAM64)).rejects.toThrow('fail');
        });
    });

    describe('getNumberOfCurrentPlayers()', () => {
        it('returns player count response', async () => {
            mockGetOk({response: {player_count: 100, result: 1}});
            await expect(api.getNumberOfCurrentPlayers(APP_ID)).resolves.toEqual({
                player_count: 100,
                result: 1,
            });
        });

        it('rejects missing appid', async () => {
            mockedAxios.get.mockRejectedValue(new Error('skip'));
            await expect(api.getNumberOfCurrentPlayers(0)).rejects.toThrow('AppID not provided.');
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getNumberOfCurrentPlayers(APP_ID)).rejects.toThrow('fail');
        });

        it('rejects falsy response', async () => {
            mockGetOk(null);
            await expect(api.getNumberOfCurrentPlayers(APP_ID)).rejects.toThrow('STEAM_ERROR');
        });
    });

    describe('getServerList()', () => {
        it('returns servers with limit', async () => {
            mockGetOk({response: {servers: [{addr: '1.1.1.1', appid: APP_ID}]}});
            await expect(api.getServerList(`\\appid\\${APP_ID}`, 10)).resolves.toEqual([
                {addr: '1.1.1.1', appid: APP_ID},
            ]);
        });

        it('returns servers without limit', async () => {
            mockGetOk({response: {servers: [{addr: '2.2.2.2'}]}});
            await expect(api.getServerList(`\\appid\\${APP_ID}`)).resolves.toEqual([
                {addr: '2.2.2.2'},
            ]);
        });

        it('rejects empty filter', async () => {
            await expect(api.getServerList('')).rejects.toThrow('Filter not provided.');
        });

        it('rejects invalid response', async () => {
            mockGetOk({response: {}});
            await expect(api.getServerList(`\\appid\\x`)).rejects.toThrow(
                'Response from steam invalid.'
            );
        });

        it('rejects when request fails', async () => {
            mockedAxios.get.mockRejectedValue(new Error('fail'));
            await expect(api.getServerList(`\\appid\\x`)).rejects.toThrow('fail');
        });
    });

    describe('branch coverage extras', () => {
        it('exercises default params on getNewsForApp and getGlobalStatsForGame', async () => {
            mockGetOk({appnews: {newsitems: []}});
            await api.getNewsForApp(APP_ID, 5, 100);

            await expect(api.getGlobalStatsForGame(APP_ID)).rejects.toThrow(
                'You must provide an array of achievement names.'
            );
        });

        it('hits instanceof Error via resolved Error from request()', async () => {
            jest.spyOn(api, 'resolveId').mockResolvedValue(STEAM64);
            const err = new Error('as-value');

            jest.spyOn(api, 'request').mockResolvedValue(err as any);
            await expect(api.getPlayerSummary(STEAM64)).rejects.toThrow('STEAM_ERROR');
            await expect(api.getPlayersSummary([STEAM64])).rejects.toThrow('STEAM_ERROR');
            await expect(api.getOwnedGames(STEAM64)).rejects.toThrow('STEAM_ERROR');
            await expect(api.getRecentlyPlayedGames(STEAM64)).rejects.toThrow('STEAM_ERROR');
            await expect(api.getPlayerBans(STEAM64)).rejects.toThrow('STEAM_ERROR');
            await expect(api.getPlayersBans([STEAM64])).rejects.toThrow('STEAM_ERROR');
            await expect(api.getFriendList(STEAM64)).rejects.toThrow(
                'Profile not found or private'
            );
            await expect(api.getUserLevel(STEAM64)).resolves.toBe(-1);
            await expect(api.isPlayingSharedGame(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
            await expect(api.getUserBadges(STEAM64)).rejects.toThrow(
                'Profile not found or private'
            );
            await expect(api.getNumberOfCurrentPlayers(APP_ID)).rejects.toThrow('STEAM_ERROR');
            await expect(api.getServerList('\\appid\\1')).rejects.toThrow(
                'Response from steam invalid.'
            );
            await expect(api.getGlobalStatsForGame(APP_ID, 1, ['a'])).rejects.toThrow(
                'Game not found.'
            );
        });

        it('hits resolveId fallback empty string path', async () => {
            jest.spyOn(api, 'resolveId').mockResolvedValue('');
            mockGetOk({response: {games: []}});
            await expect(api.getOwnedGames('x')).resolves.toEqual([]);
            await expect(api.getRecentlyPlayedGames('x')).resolves.toEqual([]);
            mockGetOk({
                players: [
                    {
                        SteamId: STEAM64,
                        CommunityBanned: false,
                        VACBanned: false,
                        NumberOfVACBans: 0,
                        DaysSinceLastBan: 0,
                        NumberOfGameBans: 0,
                        EconomyBan: 'none',
                    },
                ],
            });
            await expect(api.getPlayerBans('x')).resolves.toMatchObject({SteamId: STEAM64});
            mockGetOk({friendslist: {friends: []}});
            await expect(api.getFriendList('x')).resolves.toEqual([]);
            mockGetOk({response: {player_level: 1}});
            await expect(api.getUserLevel('x')).resolves.toBe(1);
            mockGetOk({response: {success: 1, lender_steamid: '0'}});
            await expect(api.isPlayingSharedGame('x', APP_ID)).resolves.toBe('0');
            mockGetOk({response: {badges: []}});
            await expect(api.getUserBadges('x')).resolves.toEqual([]);
            mockGetOk({playerstats: {success: true, achievements: []}});
            await expect(api.getPlayerAchievements('x', APP_ID)).resolves.toEqual([]);
            mockGetOk({playerstats: {stats: []}});
            await expect(api.getUserStatsForGame('x', APP_ID)).resolves.toEqual([]);
            mockGetOk({response: {players: [{steamid: STEAM64}]}});
            await expect(api.getPlayerSummary('x')).resolves.toMatchObject({steamid: STEAM64});
        });

        it('hits nullish optional-chain branches', async () => {
            mockGetOk(null);
            await expect(api.getNewsForApp(APP_ID)).rejects.toThrow('Game news not found.');
            await expect(api.getGlobalAchievementPercentagesForApp(APP_ID)).rejects.toThrow(
                'Game not found.'
            );

            jest.spyOn(api, 'resolveId').mockResolvedValue(STEAM64);
            jest.spyOn(api, 'request').mockResolvedValue(null);
            await expect(api.getPlayerSummary(STEAM64)).rejects.toThrow('STEAM_ERROR');
            await expect(api.getPlayerBans(STEAM64)).rejects.toThrow('STEAM_ERROR');
            await expect(api.getPlayersBans([STEAM64])).rejects.toThrow('STEAM_ERROR');
            await expect(api.getFriendList(STEAM64)).rejects.toThrow(
                'Profile not found or private'
            );
            await expect(api.isPlayingSharedGame(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
            await expect(api.getPlayerAchievements(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
        });

        it('hits nested optional-chain short circuits', async () => {
            jest.spyOn(api, 'resolveId').mockResolvedValue(STEAM64);
            const request = jest.spyOn(api, 'request');

            request.mockResolvedValue({response: null});
            await expect(api.getPlayerSummary(STEAM64)).rejects.toThrow('STEAM_ERROR');
            await expect(api.isPlayingSharedGame(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );

            request.mockResolvedValue({response: {players: null}});
            await expect(api.getPlayerSummary(STEAM64)).rejects.toThrow('STEAM_ERROR');

            request.mockResolvedValue({response: {}});
            await expect(api.getPlayerSummary(STEAM64)).rejects.toThrow('STEAM_ERROR');

            request.mockResolvedValue({playerstats: null});
            await expect(api.getPlayerAchievements(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
        });
        it('hits vanity resolve when request resolves to Error / null / missing response', async () => {
            jest.spyOn(api, 'request').mockResolvedValue(new Error('x') as any);
            await expect(api.resolveId('somevanityuser')).rejects.toThrow('ID not found.');

            (api.request as jest.Mock).mockResolvedValue(null);
            await expect(api.resolveId('somevanityuser2')).rejects.toThrow('ID not found.');

            (api.request as jest.Mock).mockResolvedValue({});
            await expect(api.resolveId('somevanityuser3')).rejects.toThrow('ID not found.');
        });

        it('hits getPlayerAchievements optional chain when playerstats missing', async () => {
            mockGetOk({});
            await expect(api.getPlayerAchievements(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
            mockGetOk({playerstats: {}});
            await expect(api.getPlayerAchievements(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
        });

        it('hits getUserLevel when request is null', async () => {
            jest.spyOn(api, 'resolveId').mockResolvedValue(STEAM64);
            jest.spyOn(api, 'request').mockResolvedValue(null);
            await expect(api.getUserLevel(STEAM64)).resolves.toBe(-1);
        });

        it('hits getUserBadges when request is null', async () => {
            jest.spyOn(api, 'resolveId').mockResolvedValue(STEAM64);
            jest.spyOn(api, 'request').mockResolvedValue(null);
            await expect(api.getUserBadges(STEAM64)).rejects.toThrow(
                'Profile not found or private'
            );
        });

        it('hits isPlayingSharedGame when response exists without success', async () => {
            mockGetOk({response: {lender_steamid: '0'}});
            await expect(api.isPlayingSharedGame(STEAM64, APP_ID)).rejects.toThrow(
                'Profile not found or private'
            );
        });
    });
});
