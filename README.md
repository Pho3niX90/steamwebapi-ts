
Main: [![Coverage Badge](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/Pho3niX90/66e2656c1157700d2adcc8a9adef6929/raw/steamwebapi_ts_heads_main.json)]

# steamwebapi-ts

> A simplified wrapper for the steam web api

This is a simple and lightweight wrapper for the steam web api. Created because the other options weren't simple enough for me.

## Documentation

### Installation

```
npm install steamwebapi-ts
```

### Usage

```typescript
import {Steam} from 'steamwebapi-ts';
const api = new Steam(API_KEY_HERE)

const id = 76561198052893297 || 'cmdline' // You can use steamID64 or the vanity url

api.getPlayerSummary(id).then(data => {
  console.log(data)
})
```

### Methods

```javascript
isRateLimited // returns obj indicating if you are rate limited
requestCount // returns obj with total requests to steam and lastReset of the counter
resolveId(id) // resolves vanity url to steamID64
getNewsForApp(appid[,count = 3, maxLength = 300])
getGlobalAchievementPercentagesForApp(appid)
getGlobalStatsForGame(appid[,count = 1, achievements = []])
getPlayerSummary(id)
getOwnedGames(id [,include_free_games=false, include_appinfo=false])
getUserLevel(id)
getUserBadges(id)
getRecentlyPlayedGames(id)
getPlayerBans(id)
getPlayerAchievements(id, appid)
getUserStatsForGame(id, appid)
getFriendList(id)
isPlayingSharedGame(id, appid)
getSchemaForGame(appid)
getAppList()
getAppInfo(appid)
getNumberOfCurrentPlayers(appid)
```

More info: https://partner.steamgames.com/doc/webapi/

## License

MIT

originally forked from https://github.com/DevNvll/steamwebapi
