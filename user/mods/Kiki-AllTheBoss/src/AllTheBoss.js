"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class AllTheBoss {
    container;
    config = require('../config/config.json');
    hordeConfig = require('../config/hordeConfig.json');
    logger;
    sniperFinder = new RegExp(/.*(snip).*/i);
    bossDictionary = {
        'Knight': 'bossKnight',
        'Gluhar': 'bossGluhar',
        'Shturman': 'bossKojaniy',
        'Sanitar': 'bossSanitar',
        'Reshala': 'bossBully',
        'Killa': 'bossKilla',
        'Tagilla': 'bossTagilla',
        'Zryachiy': 'bossZryachiy',
        'Kaban': 'bossBoar',
        'Kolontay': 'bossKolontay',
        'Partisan': 'bossPartisan',
        'Cultist': 'sectantPriest'
    };
    mapDictionary = {
        'Customs': 'bigmap',
        'FactoryDay': 'factory4_day',
        'FactoryNight': 'factory4_night',
        'Interchange': 'interchange',
        'Laboratory': 'laboratory',
        'Reserve': 'rezervbase',
        'Shoreline': 'shoreline',
        'Woods': 'woods',
        'Lighthouse': 'lighthouse',
        'Streets': 'tarkovstreets',
        'GroundZero': 'sandbox_high'
    };
    zoneList = [];
    originalZones = [];
    bossList = [];
    bossNames = [];
    raider = [];
    rogue = [];
    crazed = [];
    bloodhound = [];
    thisMap = [];
    /**
     * Loops through the configs, adding any required bosses to thismap[] then merges with the maps BossLocationSpawn[]
     * @param container container
     */
    postDBLoad(container) {
        this.container = container;
        this.logger = this.container.resolve('WinstonLogger');
        const databaseServer = this.container.resolve('DatabaseServer');
        const locations = databaseServer.getTables().locations;
        // Vérifions si les maps existent toujours comme prévu
        for (const mapKey in this.mapDictionary) {
            const locationKey = this.mapDictionary[mapKey];
            if (!locations[locationKey] || !locations[locationKey].base) {
                this.logger.error(`[AllTheBoss] Location not found: ${locationKey}`);
            }
        }
        this.populateBossList(locations);
        this.cloneSubBoss('raider', locations);
        this.cloneSubBoss('rogue', locations);
        this.cloneSubBoss('bloodhound', locations);
        this.cloneSubBoss('crazed', locations);
        for (const eachMap in this.config.maps) {
            // Vérifier si la map existe
            if (!this.mapDictionary[eachMap]) {
                this.logger.error(`[AllTheBoss] Map not found in mapDictionary: ${eachMap}`);
                continue;
            }
            const locationKey = this.mapDictionary[eachMap];
            if (!locations[locationKey]) {
                this.logger.error(`[AllTheBoss] Location not found in database: ${locationKey}`);
                continue;
            }
            this.populateZoneList(eachMap, locations);
            if (this.config.keepOriginalBossZones === true) {
                this.populateOriginalZones(eachMap, locations);
            }
            if (this.config.maps[eachMap].enabled === true) {
                this.setBosses(eachMap, locations);
                this.sanatizeMap(eachMap, locations);
            }
            if (this.config.raiders.boostRaiders.enabled === true && (eachMap === 'Reserve' || eachMap === 'Laboratory')) {
                this.boostSubBoss('raiders', eachMap, locations);
            }
            if (this.config.rogues.boostRogues.enabled === true && eachMap === 'Lighthouse') {
                this.boostSubBoss('rogues', eachMap, locations);
            }
            if (this.config.raiders.addRaiders.enabled === true) {
                this.addSubBoss('raiders', eachMap, locations);
            }
            if (this.config.rogues.addRogues.enabled === true) {
                this.addSubBoss('rogues', eachMap, locations);
            }
            if (this.config.bloodhounds.addBloodhounds.enabled === true) {
                this.addSubBoss('bloodhounds', eachMap, locations);
            }
            if (this.config.crazedScavs.addCrazedScavs.enabled === true) {
                this.addSubBoss('crazedScavs', eachMap, locations);
            }
            if (this.hordeConfig.hordesEnabled === true && this.hordeConfig.maps[eachMap] && this.hordeConfig.maps[eachMap].enabled === true) {
                this.setBossHordes(eachMap, locations);
            }
            if (this.config.shuffleBossOrder === true) {
                this.shuffleArray(this.thisMap);
            }
            //Set the maps BossLocationSpawn[] and clear thisMap[]
            locations[this.mapDictionary[eachMap]].base.BossLocationSpawn = [...locations[this.mapDictionary[eachMap]].base.BossLocationSpawn, ...this.thisMap];
            this.thisMap = [];
            if (this.config.debug === true) {
                this.logger.log(`\n${eachMap} \n${JSON.stringify(locations[this.mapDictionary[eachMap]].base.BossLocationSpawn, null, 1)}`, 'yellow', 'black');
            }
        }
    }
    /**
     * If randomizeBossZonesEachRaid is enabled, randomizes each bosses spawn zone each raid with setBossZones()
     * @param container Container
     */
    preSptLoad(container) {
        this.container = container;
        this.logger = this.container.resolve("WinstonLogger");
        // Vérification de compatibilité avec d'autres mods
        const preSptModLoader = this.container.resolve("PreSptModLoader");
        const loadedMods = preSptModLoader.getImportedModsNames();
        // Check for incompatible mods like SWAG
        if (loadedMods.includes("SWAG")) {
            this.logger.error("[AllTheBoss] INCOMPATIBLE MOD DETECTED: SWAG. This may cause conflicts with boss spawns.");
        }
        if (loadedMods.includes("PreyToLive-BetterSpawnsPlus")) {
            this.logger.warning("[AllTheBoss] SEMI-COMPATIBLE MOD DETECTED: Better Spawns Plus. Ensure BSP isn't configured to override boss spawn chances.");
        }
        const staticRouterModService = this.container.resolve("StaticRouterModService");
        if (this.config.randomizeBossZonesEachRaid === true) {
            staticRouterModService.registerStaticRouter("setBossZones", [
                {
                    url: "/raid/profile/save",
                    action: (url, info, sessionId, output) => {
                        this.setBossZones();
                        return output;
                    }
                }
            ], "spt");
        }
    }
    /**
     * Randomizes each bosses spawn zone
     */
    setBossZones() {
        const locations = this.container.resolve('DatabaseServer').getTables().locations;
        if (this.config.keepOriginalBossZones === true) {
            for (let eachMap in this.config.maps) {
                if (!this.mapDictionary[eachMap] || !locations[this.mapDictionary[eachMap]]) {
                    continue; // Skip if map doesn't exist
                }
                this.populateOriginalZones(eachMap, locations);
            }
        }
        for (let eachMap in this.config.maps) {
            if (!this.mapDictionary[eachMap] || !locations[this.mapDictionary[eachMap]]) {
                continue; // Skip if map doesn't exist
            }
            for (let boss in locations[this.mapDictionary[eachMap]].base.BossLocationSpawn) {
                let thisBoss = locations[this.mapDictionary[eachMap]].base.BossLocationSpawn[boss];
                thisBoss.BossZone = this.chooseZone(eachMap, locations);
            }
        }
    }
    /**
     * Searches through the boss waves of each map, if each boss is not already found
     * It then copies the boss object to bossList, and the name to BossNames for quick reference
     * @param locations The container/locations
     */
    populateBossList(locations) {
        for (let map in this.config.maps) {
            if (!this.mapDictionary[map] || !locations[this.mapDictionary[map]]) {
                continue; // Skip if map doesn't exist
            }
            for (let eachBoss of locations[this.mapDictionary[map]].base.BossLocationSpawn) {
                if (!this.bossNames.includes(eachBoss.BossName) &&
                    eachBoss.BossName !== 'pmcBot' &&
                    eachBoss.BossName !== 'exUsec' &&
                    eachBoss.BossName !== 'crazyAssaultEvent' &&
                    eachBoss.BossName !== 'arenaFighterEvent') {
                    this.bossNames.push(eachBoss.BossName);
                    this.bossList.push(JSON.parse(JSON.stringify(eachBoss)));
                }
            }
        }
        for (let eachBoss in this.bossList) {
            this.bossList[eachBoss].BossZone = '';
            this.bossList[eachBoss].BossChance = 0;
        }
    }
    /**
     * Makes a copy of the target sub-boss
     * @param target raider, rogue, bloodhound, crazed
     * @param locations The container/locations
     */
    cloneSubBoss(target, locations) {
        let loc = target === 'raider' ? 'rezervbase' :
            target === 'bloodhound' ? 'woods' :
                'lighthouse';
        let targetName = target === 'raider' ? 'pmcBot' :
            target === 'rogue' ? 'exUsec' :
                target === 'crazed' ? 'crazyAssaultEvent' :
                    'arenaFighterEvent';
        // Vérifier si la location existe
        if (!locations[loc]) {
            this.logger.error(`[AllTheBoss] Location not found for cloneSubBoss: ${loc}`);
            return;
        }
        for (let eachBoss in locations[loc].base.BossLocationSpawn) {
            if (locations[loc].base.BossLocationSpawn[eachBoss].BossName === targetName) {
                this[target] = JSON.parse(JSON.stringify(locations[loc].base.BossLocationSpawn[eachBoss]));
                break;
            }
        }
        // Si on n'a pas trouvé le boss cible, créer une structure par défaut
        if (!this[target]) {
            this.logger.warning(`[AllTheBoss] Boss ${targetName} not found in ${loc}, creating default structure`);
            this[target] = {
                "BossName": targetName,
                "BossChance": 0,
                "BossZone": "",
                "BossPlayer": false,
                "BossDifficult": "normal",
                "BossEscortType": "followerDefault",
                "BossEscortDifficult": "normal",
                "BossEscortAmount": "0",
                "Time": -1,
                "TriggerId": "",
                "TriggerName": "",
                "Supports": null,
                "RandomTimeSpawn": false
            };
        }
        this[target].BossChance = 0;
        this[target].BossZone = '';
        this[target].Time = 0;
        this[target].BossEscortAmount = 0;
    }
    /**
     * Populates zoneList with the maps openZones
     * @param map The map to extract the zones from
     * @param locations The container/locations
     */
    populateZoneList(map, locations) {
        if (!this.mapDictionary[map] || !locations[this.mapDictionary[map]]) {
            this.logger.error(`[AllTheBoss] Cannot populate zone list for map: ${map}`);
            this.zoneList = [];
            return;
        }
        this.zoneList = locations[this.mapDictionary[map]].base.OpenZones.split(',');
        this.zoneList = this.zoneList.filter(zone => !zone.match(this.sniperFinder));
    }
    /**
     * populates originalZones with bosses original spawn zones
     * @param map The map to extract the zones from
     * @param locations The container/locations
     */
    populateOriginalZones(map, locations) {
        if (!this.mapDictionary[map] || !locations[this.mapDictionary[map]]) {
            this.logger.error(`[AllTheBoss] Cannot populate original zones for map: ${map}`);
            this.originalZones[map] = [];
            return;
        }
        let bossLocations = locations[this.mapDictionary[map]].base.BossLocationSpawn;
        bossLocations = bossLocations.filter(boss => this.bossNames.includes(boss.BossName) && boss.BossName !== 'sectantPriest');
        let bossZones = bossLocations.map(boss => boss.BossZone.split(',')).flat();
        this.originalZones[map] = [...new Set(bossZones)];
    }
    /**
     * @param min Min
     * @param max Max
     * @returns Random int between min and max
     */
    getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min) + min);
    }
    /**
     * Pick a random zone from zoneList
     * @param map Map
     * @param locations The container/locations
     * @returns Random zone
     */
    chooseZone(map, locations) {
        if (!this.mapDictionary[map]) {
            this.logger.error(`[AllTheBoss] Cannot choose zone for unknown map: ${map}`);
            return "BotZone";
        }
        if (map === 'FactoryDay' || map === 'FactoryNight') {
            return 'BotZone';
        }
        if (this.config.keepOriginalBossZones === true && map !== 'Laboratory') {
            if (!this.originalZones[map] || this.originalZones[map].length === 0) {
                this.logger.warning(`[AllTheBoss] No original boss zones found for ${map}, using default zone`);
                return "BotZone";
            }
            return this.originalZones[map].join(',');
        }
        if (this.zoneList.length < 1) {
            this.populateZoneList(map, locations);
            if (this.zoneList.length < 1) {
                this.logger.warning(`[AllTheBoss] No zones found for ${map}, using default zone`);
                return "BotZone";
            }
        }
        let rand = this.getRandomInt(0, this.zoneList.length);
        let thisZone = this.zoneList[rand];
        this.zoneList.splice(rand, 1);
        return `${thisZone}`;
    }
    /**
     * Finds the specified boss in bossList and pushes a copy to thisMap with the chance and zone set
     * @param name Name of boss
     * @param chance Chance to spawn
     * @param map Map
     * @param locations The container/locations
     */
    getBoss(name, chance, map, locations) {
        for (let eachBoss of this.bossList) {
            if (eachBoss.BossName === name) {
                let thisBoss = eachBoss;
                thisBoss.BossChance = chance;
                thisBoss.BossZone = this.chooseZone(map, locations);
                this.thisMap.push(JSON.parse(JSON.stringify(thisBoss)));
            }
        }
    }
    /**
     * Loops through the maps potential bosses, and sets those required to spawn with getboss()
     * @param map Map
     * @param locations The container/locations
     */
    setBosses(map, locations) {
        if (!this.config.maps[map] || !this.config.maps[map].bossList) {
            this.logger.error(`[AllTheBoss] Cannot set bosses for map ${map}, missing configuration`);
            return;
        }
        for (let eachBoss in this.config.maps[map].bossList) {
            let thisBoss = this.config.maps[map].bossList[eachBoss];
            let name = this.bossDictionary[eachBoss];
            if (!name) {
                this.logger.warning(`[AllTheBoss] Unknown boss name in config: ${eachBoss}`);
                continue;
            }
            for (let i = 0; i < thisBoss.amount; i++) {
                this.getBoss(name, thisBoss.chance, map, locations);
            }
        }
    }
    /**
     * Removes any unwanted bosses from the maps original bossSpawns[]
     * @param map Map
     * @param locations The container/locations
     */
    sanatizeMap(map, locations) {
        if (!this.mapDictionary[map] || !locations[this.mapDictionary[map]]) {
            this.logger.error(`[AllTheBoss] Cannot sanitize map: ${map}`);
            return;
        }
        for (let i = Object.keys(locations[this.mapDictionary[map]].base.BossLocationSpawn).length - 1; i >= 0; i--) {
            let thisBoss = locations[this.mapDictionary[map]].base.BossLocationSpawn[i];
            if (this.bossNames.includes(thisBoss.BossName) ||
                this.config.raiders.removeRaiders === true && thisBoss.BossName === 'pmcBot' ||
                this.config.rogues.removeRogues === true && thisBoss.BossName === 'exUsec') {
                locations[this.mapDictionary[map]].base.BossLocationSpawn.splice(i, 1);
            }
        }
    }
    /**
     * Sets the chance, time and escort amount for raiders / rogues in the maps original bossSpawns[]
     * @param target 'raider' / 'rogue'
     * @param map Map
     * @param locations The container/locations
     */
    boostSubBoss(target, map, locations) {
        if (!this.mapDictionary[map] || !locations[this.mapDictionary[map]]) {
            this.logger.error(`[AllTheBoss] Cannot boost sub-boss for map: ${map}`);
            return;
        }
        let targetType = target === 'raiders' ? 'boostRaiders' : 'boostRogues';
        let targetName = target === 'raiders' ? 'pmcBot' : 'exUsec';
        for (let eachBot in locations[this.mapDictionary[map]].base.BossLocationSpawn) {
            let thisBot = locations[this.mapDictionary[map]].base.BossLocationSpawn[eachBot];
            if (thisBot.BossName === targetName) {
                thisBot.BossChance = this.config[target][targetType].chance;
                thisBot.Time = this.config[target][targetType].time;
                thisBot.BossEscortAmount = this.config[target][targetType].escortAmount;
            }
        }
    }
    /**
     * Add additional subBoss groups to the map.
     * @param target raider, rogue, bloodhound, crazed
     * @param map Map
     * @param locations The container/locations
     */
    addSubBoss(target, map, locations) {
        if (!this.mapDictionary[map]) {
            this.logger.error(`[AllTheBoss] Cannot add sub-boss for unknown map: ${map}`);
            return;
        }
        let targetType = target === 'raiders' ? 'addRaiders' :
            target === `rogues` ? 'addRogues' :
                target === `crazedScavs` ? 'addCrazedScavs' :
                    'addBloodhounds';
        if (!this.config[target] || !this.config[target][targetType] || !this.config[target][targetType].maps[map]) {
            this.logger.warning(`[AllTheBoss] Missing configuration for sub-boss ${target} on map ${map}`);
            return;
        }
        let getTarget = target === 'raiders' ? this.raider :
            target === 'rogues' ? this.rogue :
                target === 'crazedScavs' ? this.crazed :
                    this.bloodhound;
        if (!getTarget) {
            this.logger.error(`[AllTheBoss] Sub-boss template not found: ${target}`);
            return;
        }
        let newSubBoss = JSON.parse(JSON.stringify(getTarget));
        newSubBoss.BossChance = this.config[target][targetType].maps[map].chance;
        newSubBoss.Time = this.config[target][targetType].maps[map].time;
        newSubBoss.BossEscortAmount = this.config[target][targetType].maps[map].escortAmount;
        for (let i = 0; i < this.config[target][targetType].maps[map].amount; i++) {
            newSubBoss.BossZone = this.chooseZone(map, locations);
            this.thisMap.push(JSON.parse(JSON.stringify(newSubBoss)));
        }
    }
    /**
     * Add any boss hordes requested in the hordeConfig
     * @param map Map
     * @param locations The container/locations
     */
    setBossHordes(map, locations) {
        if (!this.hordeConfig.maps[map]) {
            this.logger.warning(`[AllTheBoss] No horde configuration found for map: ${map}`);
            return;
        }
        if (this.hordeConfig.maps[map].addRandomHorde && this.hordeConfig.maps[map].addRandomHorde.enabled === true) {
            let thisHorde = this.hordeConfig.maps[map].addRandomHorde;
            for (let i = 0; i < thisHorde.numberToGenerate; i++) {
                this.addRandomHorde(thisHorde.minimumSupports, thisHorde.maximumSupports, map, locations);
            }
        }
        if (this.hordeConfig.maps[map].bossList) {
            for (let eachBoss in this.hordeConfig.maps[map].bossList) {
                let thisBoss = this.hordeConfig.maps[map].bossList[eachBoss];
                if (!this.bossDictionary[eachBoss]) {
                    this.logger.warning(`[AllTheBoss] Unknown boss in horde config: ${eachBoss}`);
                    continue;
                }
                for (let i = 0; i < thisBoss.amount; i++) {
                    this.addBossHorde(this.bossDictionary[eachBoss], map, thisBoss.chance, thisBoss.escorts, thisBoss.escortAmount, locations);
                }
            }
        }
    }
    /**
     * Adds a boss horde to thisMap
     * @param target Boss to use as leader
     * @param map Map
     * @param chance Spawn chance
     * @param escorts Comma seperated string with the names of the bosses to escort the leader
     * @param escortAmounts Comma seperated string with the ammount of each escort
     * @param locations The container/locations
     */
    addBossHorde(target, map, chance, escorts, escortAmounts, locations) {
        let myEscorts = escorts.split(',');
        let myAmounts = escortAmounts.split(',');
        let thisBoss = JSON.parse(JSON.stringify(this.bossList.find(e => e.BossName === target)));
        if (!thisBoss) {
            this.logger.error(`[AllTheBoss] Boss not found for horde leader: ${target}`);
            return;
        }
        thisBoss.BossChance = chance;
        thisBoss.BossZone = this.chooseZone(map, locations);
        myEscorts.forEach((e, i) => {
            if (!thisBoss.Supports)
                thisBoss.Supports = [];
            if (!this.bossDictionary[e]) {
                this.logger.warning(`[AllTheBoss] Unknown escort boss in horde: ${e}`);
                return;
            }
            thisBoss.Supports.push({
                "BossEscortType": this.bossDictionary[e],
                "BossEscortDifficult": [
                    "normal"
                ],
                "BossEscortAmount": myAmounts[i]
            });
        });
        this.thisMap.push(JSON.parse(JSON.stringify(thisBoss)));
    }
    /**
     * Add a randomized boss horde using addBossHorde()
     * @param minimumSupports Minimum number of supports
     * @param maximumSupports Maximum number of supports
     * @param map Map
     * @param locations The container/locations
     */
    addRandomHorde(minimumSupports, maximumSupports, map, locations) {
        let options = [
            'Knight',
            'Gluhar',
            'Shturman',
            'Sanitar',
            'Reshala',
            'Killa',
            'Tagilla',
            'Kaban',
            'Zryachiy',
            'Kolontay'
        ];
        // Vérifier si chaque boss est valide et existe dans le dictionnaire
        options = options.filter(boss => this.bossDictionary[boss] && this.bossList.some(b => b.BossName === this.bossDictionary[boss]));
        if (options.length === 0) {
            this.logger.error("[AllTheBoss] No valid bosses found for random horde");
            return;
        }
        let bigBossindex = this.getRandomInt(0, options.length);
        if (bigBossindex >= options.length)
            bigBossindex = options.length - 1;
        let bigBoss = this.bossDictionary[options[bigBossindex]];
        options.splice(bigBossindex, 1);
        let tally = 0;
        let supports = [];
        let supportAmmounts = [];
        let done = false;
        while (done === false && options.length > 0) {
            let rand = this.getRandomInt(1, maximumSupports - tally);
            tally += rand;
            let supportIndex = this.getRandomInt(0, options.length);
            if (supportIndex >= options.length)
                supportIndex = options.length - 1;
            supports.push(options[supportIndex]);
            options.splice(supportIndex, 1);
            supportAmmounts.push(rand);
            if (tally > minimumSupports && Math.round(Math.random()) === 1 || tally >= maximumSupports || options.length < 1) {
                done = true;
            }
        }
        if (supports.length > 0) {
            this.addBossHorde(bigBoss, map, 100, supports.join(','), supportAmmounts.join(','), locations);
        }
        else {
            this.logger.warning("[AllTheBoss] Could not create random horde with sufficient supports");
        }
    }
    /**
     * Shuffles elements in an array into a random order
     * @param array Array
     */
    shuffleArray(array) {
        for (var i = array.length - 1; i > 0; i--) {
            var j = this.getRandomInt(0, i + 1);
            var temp = array[i];
            array[i] = array[j];
            array[j] = temp;
        }
    }
}
module.exports = { mod: new AllTheBoss() };
//# sourceMappingURL=AllTheBoss.js.map