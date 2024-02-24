import {Steam} from '../src';
import * as dotenv from 'dotenv';
import {SteamPlayerBans} from '../src/types/SteamPlayerBans';

const SteamID = require('steamid');

if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}
const api = new Steam(process.env.STEAM_API_KEY, 30000);

const testData = {
    a: {
        vanityId: 'Pho3niX90',
        steamId: 'STEAM_0:1:23584097',
        steamId3: '[U:1:47168195]',
        steamId64: '76561198007433923',
        name: 'Pho3niX90'
    },
    b: {
        vanityId: 'serverarmour',
        steamId: 'STEAM_0:0:542092900',
        steamId3: '[U:1:1084185800]',
        steamId64: '76561199044451528',
        name: 'ServerArmour.com'
    },
    c: {
        steamId64: '76561197972187320'
    }
}

const testAppId = 252490;

it('constructor test', async () => {
    expect(api).toBeDefined();
    // @ts-ignore
    expect(() => new Steam()).toThrow(Error);
});

it('should resolve vanity', async () => {
    const vanityResponse = api.resolveId(testData.a.vanityId);
    const steamIdResponse = api.resolveId(testData.a.steamId);
    const steam3Response = api.resolveId(testData.a.steamId3);
    const steam64Response = api.resolveId(testData.a.steamId64);

    await expect(vanityResponse).resolves.toBe(testData.a.steamId64);
    await expect(steam64Response).resolves.toBe(testData.a.steamId64);
    await expect(steam3Response).resolves.toBe(testData.a.steamId64);
    await expect(steamIdResponse).resolves.toBe(testData.a.steamId64);

    api.resolveId('').catch(err => expect(err.message).toBe('ID not provided.'))
    api.resolveId('null/*-/-*').catch(err => expect(err.message).toBe('ID not found.'))
})

it('getNewsForApp()', async () => {
    const response = await api.getNewsForApp(testAppId);
    expect(response).toBeDefined()

    api.getNewsForApp(0).catch(err => expect(err.message).toBe('AppID not provided.'));
    api.getNewsForApp(74545454687846).catch(err => expect(err.message).toBe('Game news not found.'))
})

it('getGlobalAchievementPercentagesForApp()', async () => {
    const response = await api.getGlobalAchievementPercentagesForApp(testAppId);
    expect(response).toBeDefined()

    api.getGlobalAchievementPercentagesForApp(0).catch(err => expect(err.message).toBe('AppID not provided.'));
    api.getGlobalAchievementPercentagesForApp(74545454687846).catch(err => expect(err.message).toBe('Game not found.'))
})

it('getGlobalStatsForGame()', async () => {
    const response = await api.getGlobalStatsForGame(testAppId, 2, [
        'bullet_fired',
        'kill_chicken'
    ]);
    expect(response).toBeDefined()

    await api.getGlobalStatsForGame(0, 0, undefined).catch(err => expect(err.message).toBe('AppID not provided.'));
    await api.getGlobalStatsForGame(74545454687846, 0, undefined).catch(err => expect(err.message).toBe('Count must be larger than 1'));
    await api.getGlobalStatsForGame(74545454687846, 1, undefined).catch(err => expect(err.message).toBe('You must provide an array of achievement names.'));
    await api.getGlobalStatsForGame(74545454687846, 1, ['bullet_fired']).catch(err => expect(err.message).toBe('Game not found.'));
})

it('getPlayerSummary()', async () => {
    const response = await api.getPlayerSummary(testData.a.vanityId);
    expect(response).toBeDefined();
    // @ts-ignore
    expect(response.steamid).toEqual(testData.a.steamId64);
    await api.getPlayerSummary('').catch(err => expect(err.message).toBe('ID not provided.'));
})

it('getPlayersSummary()', async () => {
    const response = await api.getPlayersSummary([testData.a.steamId64, testData.b.steamId64]);
    expect(response).toBeDefined();
    expect(response.length).toEqual(2);


    // @ts-ignore
    api.getPlayersSummary(null).catch(err => expect(err.message).toBe('IDs not provided.'));
    api.getPlayersSummary([]).catch(err => expect(err.message).toBe('IDs not provided.'));

    const arr1 = response[0];
    const arr2 = response[1];
    expect([testData.a.steamId64, testData.b.steamId64].includes(arr1.steamid)).toEqual(true);
    expect([arr1.personaname, arr2.personaname].includes(testData.a.name)).toEqual(true);

    expect([testData.a.steamId64, testData.b.steamId64].includes(arr2.steamid)).toEqual(true);
    expect([arr1.personaname, arr2.personaname].includes(testData.b.name)).toEqual(true);
})

it('getOwnedGames()', async () => {
    const response = await api.getOwnedGames(testData.a.vanityId);
    expect(response).toBeDefined()

    const testApp = response.filter(x => x.appid === testAppId);
    expect(testApp).toBeDefined();
    expect(testApp.length).toEqual(1);

    expect(testApp.shift()?.playtime_forever).toBeGreaterThan(248296)
})

/*it('getRecentlyPlayedGames()', async () => {
    const response = await api.getRecentlyPlayedGames(testData.a.vanityId);
    expect(response).toBeDefined()
})*/

it('getPlayerBans()', async () => {
    const response = await api.getPlayerBans(testData.a.vanityId);
    expect(response).toBeDefined()
    expect(Object.keys(response).length).toEqual(7);
    expect(response).toEqual(<SteamPlayerBans>{
        SteamId: testData.a.steamId64,
        CommunityBanned: false,
        VACBanned: false,
        NumberOfVACBans: 0,
        DaysSinceLastBan: 0,
        NumberOfGameBans: 0,
        EconomyBan: 'none'
    })
})

it('getPlayersBans()', async () => {
    const response = await api.getPlayersBans([testData.a.steamId64, testData.b.steamId64, testData.c.steamId64]);
    expect(response).toBeDefined()
    expect(response.length).toEqual(3);
})

/* it('getPlayerAchievements()', async () => {
    const response = api.getPlayerAchievements(testData.a.vanityId, testAppId);
    const achieved = api.getPlayerAchievements(testData.a.vanityId, testAppId, true);
    expect(await response).toBeDefined();
    expect(await achieved).toBeDefined();

    await api.getPlayerAchievements(testData.a.vanityId, 0).catch(err => expect(err.message).toBe('AppID not provided.'));
    await api.getPlayerAchievements(testData.a.vanityId, 0, true).catch(err => expect(err.message).toBe('AppID not provided.'));
    await api.getPlayerAchievements('76561199225710783', testAppId).catch(err => expect(err.message).toBe('Profile not found or private'));
}, 30000) */

/* it('getUserStatsForGame()', async () => {
    //the only endpoint that gives an Internal Server Error when the profile is private --'
    const response = api.getUserStatsForGame(testData.a.vanityId, testAppId);
    expect(await response).toBeDefined();

    await api.getUserStatsForGame(testData.a.vanityId, null).catch(err => expect(err.message).toBe('AppID not provided.'));
    await api.getUserStatsForGame('76561199225710783', testAppId).catch(err => expect(err.message).toBe('Profile not found or private'));
    api
        .getUserStatsForGame(testData.a.vanityId, testAppId)
        .then(response => {
            expect(response).toBeDefined()
        })
        .catch(err => {
            expect(err).toBe('Profile not found or private')
        })
}); 

 it('getFriendList()', async () => {
    expect(await api.getFriendList(testData.a.vanityId)).toBeDefined();
    expect(await api.getFriendList(testData.b.vanityId)).toBeDefined();
    await api.getFriendList('76561199225710783').catch(err => expect(err.message).toBe('Profile not found or private'));
}); */

it('isPlayingSharedGame()', async () => {

    const response = api.isPlayingSharedGame(testData.a.vanityId, testAppId)
    response.catch(err => expect(err.message).toBe('Profile not found or private'));
    const response2 = api.isPlayingSharedGame(testData.a.vanityId, 0)
    response2.catch(err => expect(err.message).toBe('AppID not provided.'));

});

it('getSchemaForGame()', async () => {
    const response = await api.getSchemaForGame(testAppId);
    api.getSchemaForGame(0).catch(err => expect(err.message).toBe('AppID not provided.'));
    expect(response).toBeDefined()
});

it('getAppList()', async () => {
    jest.setTimeout(30000);
    const response = await api.getAppList();
    expect(response).toBeDefined()
}, 30000);

it('getAppInfo()', async () => {
    const response = await api.getAppInfo(testAppId);
    api.getAppInfo(0).catch(err => expect(err.message).toBe('AppID not provided.'));
    api.getAppInfo(76561199225710783).catch(err => expect(err.message).toBe('App not found.'));
    expect(response).toBeDefined()
});

it('getUserLevel()', async () => {
    const response = await api.getUserLevel(testData.a.vanityId);
    expect(response).toBeGreaterThan(41)

    const response2 = await api.getUserLevel('76561198253741052');
    expect(response2).toBe(-1);
});

it('getUserBadges()', async () => {
    const response = await api.getUserBadges(testData.a.vanityId);
    expect(response).toBeDefined();
    await api.getUserBadges('0').catch(async err => {
        expect(err.message).toBe('Profile not found or private')
    });
});

it('getNumberOfCurrentPlayers()', async () => {
    const response = await api.getNumberOfCurrentPlayers(testAppId).catch(err => expect(err.message).toBe('AppID not provided.'));
    expect(response).toBeDefined();

    await api.getNumberOfCurrentPlayers(0).catch(err => expect(err.message).toBe('AppID not provided.'));
}, 30000);

it('getServerList()', async () => {
    let serverLimit = 200;
    let randomChecks = 3;

    const response = await api.getServerList(`\\appid\\${testAppId}`, serverLimit);

    expect(response).toBeDefined();
    expect(response.length).toEqual(serverLimit);

    for (let i = 0; i < randomChecks; i++) {
        const rndInt = Math.floor(Math.random() * serverLimit) + 1
        expect(response[Math.min(rndInt, response.length - 1)].appid).toBe(testAppId);
    }

    await api.getServerList(``, serverLimit).catch(err => expect(err.message).toBe('Filter not provided.'));
    await api.getServerList(`\\appid\\shouldNotExists`, serverLimit).catch(err => expect(err.message).toBe('Response from steam invalid.'));

}, 30000);

it('steamid library', async () => {
    expect(new SteamID(testData.a.steamId).isValid()).toEqual(true);
    expect(new SteamID(testData.a.steamId3).isValid()).toEqual(true);
    expect(new SteamID(testData.a.steamId64).isValid()).toEqual(true);
    expect(() => new SteamID(testData.a.vanityId)).toThrowError();
})
