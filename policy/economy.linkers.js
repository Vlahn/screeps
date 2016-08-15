/**
 * Created by Piers on 19/07/2016.
 */
/**
 * @fileOverview Requisition object for using the pool
 * @author Piers Shepperson
 */
"use strict";
var roomOwned = require("room.owned");
var routeBase = require("route.base");
var RouteLinker = require("route.linker");
var RouteNeutralPorter = require("route.neutral.porter");
var RouteRemoteActions = require("route.remote.actions");
var RouteRepairer = require("route.repairer");
var RouteFlexiStoragePorter = require("route.flexi.storage.porter");
var gc = require("gc");
var policy = require("policy");
var raceClaimer = require("race.claimer");
var RoutePatrolRoom = require("route.patrol.room");
var RouteGiftCreep  = require("route.gift.creep");
var raceSwordsman = require("race.swordsman");
var raceWorker = require("race.worker");
var RouteMiner = require("route.miner");
var roomController = require("room.controller")
var RouteSuppressKeepers = require("route.suppress.keepers");
var RouteNeutralHarvester = require("route.neutral.harvest");

/**
 * Requisition object for using the pool
 * @module economyLinkers
 */

var economyLinkers = {
    LINK_TO_SOURCE_RANGE: 2,

    attachFlaggedRoutes: function (room, policy) {

        if (!this.notReadyForLinkers(room))
            return;

        var flags = _.filter(Game.flags, function (flag) {
            return ( flag.memory.linkerFrom
                    && (flag.memory.linkerFrom.room == room.name
                    || flag.memory.porterFrom.room == room.name) );
        });
        for ( var i = 0 ; i < flags.length ; i++ ) {

            if (flags[i].memory.keeperLairRoom
                && flags[i].memory.linkerFrom.room == room.name) {

                this.suppressKeeperRoom(
                    room,
                    flags[i].pos.roomName,
                    flags[i].memory.linkerFrom.distance
                );
            }

            if ( gc.FLAG_SOURCE == flags[i].memory.type
                || (gc.FLAG_MINERAL == flags[i].memory.type
                && this.useLinkerMiner(room, flags[i])) )  {

                this.attachHarvestLinker(room, flags[i], policy);

            } else if (gc.FLAG_MINERAL == flags[i].memory.type) {
                this.attachFlaggedMiner(room, flags[i]);
            }

            if (flags[i].pos.roomName != room.name
                && flags[i].memory.porterFrom
                && room.name == flags[i].memory.porterFrom.room) {

                this.attachNeutralPorter(room, flags[i]);
            }
        }
        this.attachFlaggedControlRoutes(room, policy);
        //this.attachFlaggedKeeperLairRoutes(room, policy);

        if (Game.time % gc.CHECK_FOR_ORPHANED_BUILDS_RATE == 0 ){
            this.checkForOrphanedBuilds(room);
        }
    },

    attachHarvestLinker: function(room, flag, policy) {
        var healUnits = flag.memory.keeperLairRoom ? gc.KEEPER_HARVESTER_HEALER_PARTS : 0;
        var defensive = (room.name != flag.pos.roomName);

        //var defensive = room.name != flag.pos.roomName;
        var order = new RouteLinker(
            room.name,
            flag.name,
            policy.id,
            defensive,
            false,
            healUnits
        );
        if (!this.keepMatchedBuildWithSameSize(
                room, "flagName", flag.name, order)) {
            var priority;
            if (flag.pos.roomName == room.name)
                priority = gc.PRIORITY_LINKER;
            else
                priority = gc.PRIORITY_NEUTRAL_LINKER;
            if (gc.FLAG_MINERAL == flag.memory.type)
                priority = gc.PRIORITY_MINER;
            if (flag.memory.keeperLairRoom)
                priority = gc.PRIORITY_KEEPER_HARVEST;
            routeBase.attachRoute(
                room.name,
                gc.ROLE_LINKER,
                order,
                priority,flag.name
            );
        }
    },

    attachNeutralPorter: function(room, flag) {
        var priority;
        //var healParts;
        var respawnMultiplyer;
        if (flag.memory.keeperLairRoom) {
            if (!this.keeperRoomSuppressed(flag.pos.roomName))
                return;
            priority = gc.PRIORITY_KEEPER_PORTER;
           // healParts = gc.KEEPER_PORTER_HEALER_PARTS;
            respawnMultiplyer = gc.RESPAWN_MULTIPLYER_KEEPER;
        } else {
            priority = gc.PRIORITY_NEUTRAL_PORTER;
            //healParts = 0;
            respawnMultiplyer = gc.RESPAWN_MULTIPLYER_NEUTRAL;
        }

        var harvesters = routeBase.filterBuildsF(room, function(build) {
            return build.type == gc.ROUTE_NEUTRAL_PORTER
                && build.flagName == flag.name;
        });
        if (!harvesters || harvesters.length == 0) {
            var order = new RouteNeutralPorter(
                room.name,
                flag.name,
                respawnMultiplyer
            );
            routeBase.attachRoute(
                room.name,
                gc.ROUTE_NEUTRAL_HARVEST,
                order,
                priority,
                flag.name
            );
        }
        if (!flag.memory.keeperLairRoom) { // Already got protection
            var soldierBody = raceSwordsman.body(gc.SWORDSMAN_NEUTRAL_PATROL_SIZE);
            this.attachPatrolCreep(flag, room, soldierBody);
        }
    },

    useLinkerMiner: function (room, flag) {
        if (flag.memory.type != gc.FLAG_MINERAL) return false;
        if (!flag.memory.extractor) return false;

        var storage = room.find(FIND_STRUCTURES, {
            filter: function(store) {
                return store.structureType == STRUCTURE_STORAGE
                    || store.structureType == STRUCTURE_TERMINAL
                    && store.storeCapacity - _.sum(store.store) > gc.KEEP_FREE_STORAGE_SPACE
            }
        });
        var inRange = flag.pos.findInRange(storage,2);
       // console.log("useLinkerMiner", room, "flag",flag,"storage",
       //     storage,"inRAnge",inRange.length>0);
        return inRange.length > 0;
    },

    attachFlaggedMiner: function (room, flag) {
        var matches = routeBase.filterBuildsF(room, function(build) {
            return build.mineId == flag.name;
        });

        var exhausted = this.mineralExhausted(flag);
        if ( (matches && matches[0] && gc.ROUTE_LINKER == matches[0].type)
              || exhausted ) {
            if (matches[0])
                routeBase.removeRoute(room, matches[0].id);
        }

        if (!matches || matches.length == 0 && !exhausted) {
            if (flag.memory.keeperLairRoom
                && !this.keeperRoomSuppressed(flag.pos.roomName))
                return;

            var storage = room.find(FIND_STRUCTURES, {
                filter: function(s) {
                    return (s.structureType == STRUCTURE_STORAGE
                        || s.structureType == STRUCTURE_TERMINAL)
                        && s.storeCapacity - _.sum(s.store) > gc.KEEP_FREE_STORAGE_SPACE
                }
            });
            if (storage.length > 0) {
                var order = new RouteMiner(
                    room.name,
                    flag.name,
                    flag.memory.resourceType,
                    flag.pos
                );
                routeBase.attachRoute(room.name, gc.ROLE_LINKER, order, gc.PRIORITY_MINER);
            }
        }
    },

    mineralExhausted: function (flag) {
        var mineral = Game.getObjectById(flag.name);
        return mineral.mineralAmount == 0;
    },

    keeperRoomSuppressed: function (roomName) {
        if (!Memory.rooms[roomName].suppressed) return false;
        return Memory.rooms[roomName].suppressed - Game.time < CREEP_LIFE_TIME;
    },

    keepMatchedBuildWithSameSize: function(room, indexField, fieldValue, order) {
        var matches = routeBase.filterBuilds(room, indexField, fieldValue);
        for (var i = 0 ; i < matches.length ; i++ ) {
            if (matches[i].type == order.type) {
                if (matches[i].size == order.size
                    && matches[i].respawnRate == order.respawnRate) {
                  //  console.log("keepMatchedBuildWithSameSize")
                    // todo If linkers die need new ones quick. Should put somewhere else.
                    if (matches[i].priority == gc.PRIORITY_LINKER && matches[i].due >0 ) {
                        routeBase.resetDueIfRouteNotActive(room, matches[i], matches[i].flagName);
                    }
                    return true;
                } else {
                    routeBase.removeRoute(room.name, matches[i].id);
                    return false;
                }
            }
        }
        return false;
    },

    attachFlaggedControlRoutes: function (room, policy) {
        var flags = _.filter(Game.flags, function (flag) {
            return ( gc.FLAG_CONTROLLER == flag.memory.type
            && flag.memory.claimerFrom
            && flag.memory.claimerFrom.room == room.name
            && flag.memory.upgradeController);
        });
        for ( var  i = 0 ; i < flags.length ; i++ ) {
           // console.log(flags[i],flags,flags.length,"start gfor loop attachFlaggedControlRoutes",i);

            var matches = routeBase.filterBuilds(room, "reference", flags[i].name);
            var foundMatchingController = false, foundMatchingPatrol = false;
            var claimerBody = raceClaimer.body(raceClaimer.maxSizeRoom(room));
            var soldierBody = raceSwordsman.body(gc.SWORDSMAN_NEUTRAL_PATROL_SIZE);
           // console.log(flags,"0 attachFlaggedControlRoutes i = ",i);
            for (var j = 0; j < matches.length; j++) {
                if (gc.ROUTE_REMOTE_ACTIONS == matches[j].type) {
                    if (claimerBody.length == matches[j].body.length) {
                        foundMatchingController = true;
                    } else {
                        console.log(room,"attachFlaggedControlRoutes type",matches[j].type,"lengths",
                            claimerBody.length,matches[j].body.length);
                        routeBase.removeRoute(room.name, matches[j].id);
                    }
                } else if (gc.ROUTE_PATROL_ROOM == matches[j].type) {
                    if (soldierBody.length == matches[j].body.length) {
                        foundMatchingPatrol = true;
                    } else {
                        routeBase.removeRoute(room.name, matches[j].id);
                    }
                }
            }
          //  console.log(flags,"1 attachFlaggedControlRoutes i = ",i);
            if (!foundMatchingController) {
                this.attachFlaggedReverseController(flags[i], room, policy, claimerBody);
            }
        //    console.log(flags,"2 attachFlaggedControlRoutesii =",i);
            if (!foundMatchingPatrol) {
               // console.log(room,"attachPatrolCreep flag",flags[i],JSON.stringify(flags[i]));
                //this.attachPatrolCreep(flags[i], room, soldierBody);
            }
        }
    },

    attachFlaggedReverseController: function (flag, room, policy, body)
    {
       // console.log(flag,"attachFlaggedReverseController");
        var actions = {
            room : flag.pos.roomName,
            action : "reserveController",
            findFunction : "findController",
            findFunctionsModule : "policy.remote.actions"
        };
        var size = body.length/2;
        var timeReversing = CREEP_CLAIM_LIFE_TIME - flag.memory.claimerFrom.distance;
        var ticksReversedLifetime = size * timeReversing;
        var respawn = ticksReversedLifetime - Math.ceil(gc.REVERSE_CLAIM_SAFETYNET / size);
        var order = new RouteRemoteActions(
            room.name,
            actions,
            body,
            respawn,
            policy.id,
            flag.name,
            size
        );
      //  console.log(flag,"attachFlaggedReverseController",JSON.stringify(order));
        routeBase.attachRoute(room.name, gc.ROUTE_REMOTE_ACTIONS,order,
            gc.PRIORITY_REVERSE_CONTROLLER,flag.name);
    },

    attachPatrolCreep: function (flag, room, body) {
        var patrols = routeBase.filterBuildsF(room, function(build) {
            return build.type == gc.ROUTE_PATROL_ROOM
                && build.patrolRoom == flag.pos.roomName;
        });

        if (!patrols || patrols.length == 0) {
            var respawn = CREEP_LIFE_TIME - flag.memory.linkerFrom.distance;
            var order = new RoutePatrolRoom(
                room.name,
                flag.pos.roomName,
                {roomName: flag.pos.roomName, x: 25, y: 25},
                body,
                respawn,
                flag.name,
                gc.SWORDSMAN_NEUTRAL_PATROL_SIZE
            );
            //   console.log(flag,"attachPatrolCreep",JSON.stringify(order));
            routeBase.attachRoute(room.name, gc.ROUTE_PATROL_ROOM,
                order,gc.PRIORITY_ROOM_PATROL,flag.name);
        }
    },

    notReadyForLinkers: function (room) {
        return room.energyCapacityAvailable > gc.MIN_ENERGY_CAPACITY_LINKERS;
    },

    alreadyInBulidQueue: function(room, flag) {
        return routeBase.filterBuilds(room,"flagName", flag.name).length > 0;
    },

    attachFlexiStoragePorters: function (room, policy) {

       // console.log(room, "attachFlexiStoragePorters, 0 < porterShortfall",
      //      this.porterShortfall(room,policy), "existing parts",  this.existingPorterParts(policy)
      //      ,"quick partsNeeded",this.quickPorterPartsNeeded(room));

    //    console.log(room, "attachFlexiStoragePorters, 0 < porterShortfall",
    ///        this.porterShortfall(room,policy), "existing parts",  this.existingPorterParts(policy)
    //        ,"porterPartsNeeded",this.porterPartsNeeded(room));

        console.log(room, "attachFlexiStoragePorters, 0 < porterShortfall",
            this.porterShortfall(room,policy), "existing parts",  this.existingPorterParts(policy));
        //this.porterPartsNeeded(room);

        var creeps = _.filter(Game.creeps, function (creep) {
            return creep.memory.policyId == policy.id
                && creep.memory.role == gc.ROLE_FLEXI_STORAGE_PORTER});

        console.log(room,"attachFlexiStoragePorters creeps", creeps.length ,
            "< max can fit in room",this.maxCreepsCanFitInRoom(room),"policy.id",policy.id );

     //  console.log(room,"number of porter parts needed",this.porterPartsNeeded(room));

      //  console.log(room,"partsForBuildQueue",this.partsForBuildQueue(room,0),
      //   "parts for upgarde",this.partsForUpgrade(room,0));
        //if (this.existingPorterParts(policy) < this.porterPartsNeeded(room))


        if ( 0 < this.porterShortfall(room,policy)
            && routeBase.filterBuilds(room,"type",gc.ROUTE_FLEXI_STORAGE_PORTER).length == 0) {


           if (creeps.length <= this.maxCreepsCanFitInRoom(room)) {
                var order = new RouteFlexiStoragePorter(room.name, 0, policy.id);
               // console.log("attachFlexiStoragePorters creeplife", this.creepLifeTicks(policy),
              //      "< middale age", gc.PORTER_PRIORITY_THRESHOLD);
               var creepLifeTicks = this.creepLifeTicks(policy);
               if (creepLifeTicks < gc.PORTER_PRIORITY_THRESHOLD) {
                    var priority = gc.PRIORITY_EMERGENCY_HOME_PORTER;
                } else {
                    priority = gc.PRIORITY_HOME_PORTER
                }
                routeBase.attachRoute(room.name, gc.ROUTE_FLEXI_STORAGE_PORTER,order,priority);
           }
        }
        //console.log(room,"End of attachFlexiStoragePorters");
    },

    suppressKeeperRoom: function(room, keeperRoom, distance) {
       // console.log("suppressKeeperRoom", room, keeperRoom, distance);
        if (room.energyCapacityAvailable < roomController.maxProduction[7])
            return;

        var suppressors = routeBase.filterBuildsF(room, function(build) {
           return build.type == gc.ROUTE_SUPPRESS_KEEPERS
               && build.keeperRoom == keeperRoom;
        });
       // console.log("suppressKeeperRoom", suppressors);
        if (suppressors.length == 0) {
            var respawnRate = CREEP_LIFE_TIME - gc.KEEPER_ATTACK_SPAWN_RATE_BUFFER - distance;
            var order = new RouteSuppressKeepers(keeperRoom, undefined, respawnRate, 14, 11);
         //   console.log("suppressKeeperRoom order", JSON.stringify(order));
            routeBase.attachRoute(room.name, gc.ROUTE_SUPPRESS_KEEPERS, order, gc.PRIORITY_KEEPER_ATTACK);
        }
    },
/*
    attachKeeperRoomHarvesters: function (room, flag) {
        var harvesters = routeBase.filterBuildsF(room, function(build) {
            return build.type == gc.ROUTE_NEUTRAL_HARVEST
                && build.flagName == flag.name;
        });
        if (!harvesters || harvesters.length == 0) {
            var order = new RouteNeutralHarvester(room.name, flag.name, gc.KEEPER_HARVESTER_HEALER_PARTS);
            routeBase.attachRoute(
                room.name,
                gc.ROUTE_NEUTRAL_HARVEST,
                order,
                gc.PRIORITY_KEEPER_HARVEST,
                flag.name
            );
        }
    },
*/
    maxCreepsCanFitInRoom: function (room) {
        if (!room.storage) {
            return roomOwned.accessPointsType(room, FIND_SOURCES) +  room.find(FIND_SOURCES).length;
        } else {
            return roomOwned.accessPointsType(room, FIND_SOURCES)
                +  room.find(FIND_SOURCES).length + 6;
        }
    },

    attachRepairer: function (room) {
        var matches = routeBase.filterBuilds(room,"type", gc.ROUTE_REPAIRER);
        var previous;
        if (matches && matches[0]) {
            previous = matches[0]
        }
        var order = new RouteRepairer(room.name, policy.id);
        if ( previous && previous.size != order.size) {
            routeBase.removeRoute(room.name,previous.id);
            previous = undefined;
        }
        if (!previous) {
            routeBase.attachRoute(room.name, gc.ROUTE_REPAIRER,order,gc.PRIORITY_REPAIRER);
        }
    },

    creepLifeTicks: function (policy) {
        var creeps = _.filter(Game.creeps, function (creep) {
            return creep.memory.policyId == policy.id});
        var life = 0;
        for ( var i = 0 ; i < creeps.length ; i++ ) {
            if (creeps[i] && creeps[i].ticksToLive)
                life = life + creeps[i].ticksToLive;
        }
        return life;
    },

    checkForOrphanedBuilds: function (room ) {
        var builds = _.filter(room.memory.routes.details, function (build) {
            return ( build !== undefined && build.owner == room.name );
        });
        //console.log(room,"checkForOrphanedBuilds",builds.length);
        for ( var i = 0 ; i < builds.length ; i++ ) {
            var flagName;
            if (builds[i].flagName) {
                flagName = builds[i].flagName;
            } else if (builds[i].reference) {
                flagName = builds[i].reference;
            }
            //console.log(room,"checkForOrphanedBuilds",flagName,flag,"type",builds[i].type);
            if (flagName) {
                var flag = Game.flags[flagName];

                if (flag ) {
                    switch (builds[i].type) {
                        case gc.ROUTE_LINKER:
                          //  console.log(room,"checkForOrphanedBuilds",flag.memory.linkerFrom.room,flagName);
                            if (flag.memory.linkerFrom && flag.memory.linkerFrom.room != room.name) {
                                routeBase.removeRoute(room.name, builds[i].id);
                            }
                            break;
                        case gc.ROUTE_NEUTRAL_PORTER:
                            if (flag.memory.porterFrom && flag.memory.porterFrom.room != room.name) {
                                routeBase.removeRoute(room.name, builds[i].id);
                            }
                            break;
                        case gc.ROUTE_REMOTE_ACTIONS:
                        case gc.ROUTE_PATROL_ROOM:
                            if (flag.memory.claimerFrom && flag.memory.claimerFrom.room != room.name) {
                                routeBase.removeRoute(room.name, builds[i].id);
                            }
                            break;
                        default:
                    } //switch
                } //if (flag )
            } //if (flagName)
        } // for
    },

    energyFromLinkersGen: function (room) {
        var linkers = routeBase.filterBuilds(room,"type",gc.ROUTE_LINKER);
        var energyCycle = 0;
        for ( var i = 0 ; i < linkers.length ; i++ ) {
            //console.log("energyFromLinkersGen", linkers.length);
            var flagName = linkers[i].flagName;
            if (flagName) {
                var flag = Game.flags[flagName];
                if (flag) {
                    if (flag.memory.energyCapacity) {
                      //  console.log(room,"energyFromLinkersGen",energyCycle);
                        energyCycle = energyCycle + flag.memory.energyCapacity;
                    }
                }
            }
        }
        return energyCycle * CREEP_LIFE_TIME / ENERGY_REGEN_TIME;
    },

    porterPartsNeeded: function (room) {
        var avProductionSupplyDistance = roomOwned.avProductionSupplyDistance(room);
        var productionEnergyPerPart = CREEP_LIFE_TIME  * CARRY_CAPACITY
            / (2 * avProductionSupplyDistance + gc.TIME_TRANSFER_LOAD);

        var avUpgradeDistance = roomOwned.avUpgradeDistance(room)
        var upgradeEnergyPerPart = CREEP_LIFE_TIME * CARRY_CAPACITY
            / ( 2 * avUpgradeDistance + gc.TIME_UPGRADE_LOAD);

        var energyAvailable = this.energyFromLinkersGen(room);
        var buildQueueEnergy = routeBase.buildQueueEnergyPerGen(room);
        var WORKER_PART_COST = raceWorker.BLOCKSIZE;
     //   console.log("production distance",avProductionSupplyDistance,"productio energy",productionEnergyPerPart,
    //        "upgrade distance", avUpgradeDistance, "upgrade energy",upgradeEnergyPerPart,
      //      "energy avaliabel",energyAvailable,"buildqueue", buildQueueEnergy);

        var denominator = WORKER_PART_COST * productionEnergyPerPart
                            - WORKER_PART_COST * upgradeEnergyPerPart
                            + productionEnergyPerPart * upgradeEnergyPerPart;

        var productionParts = ( WORKER_PART_COST * energyAvailable + upgradeEnergyPerPart * buildQueueEnergy )
                                / denominator;


        var upgradeParts = ( productionEnergyPerPart *  energyAvailable
                            - WORKER_PART_COST * energyAvailable - productionEnergyPerPart * buildQueueEnergy )
                            / denominator;
        console.log("porterPartsNeeded poductin", productionParts, "upgrade", upgradeParts,
            "total", productionParts + upgradeParts);
        return productionParts + upgradeParts;
    },

    processBuildQueue: function(room) {
        var spawns = room.find(FIND_MY_SPAWNS);
        var nextBuild = routeBase.nextBuild(room);
        if (undefined !== nextBuild) {
            var i = spawns.length-1;
            do {
                var result = routeBase.spawn(spawns[i], room, nextBuild);
            } while ( result == ERR_BUSY && i--)
        }
    },

    existingPorterParts: function (currentPolicy) {
        var parts = 0;
        var porters = _.filter(Game.creeps, function (creep) {
            return (creep.memory.policyId == currentPolicy.id
            &&  creep.memory.role == gc.ROLE_FLEXI_STORAGE_PORTER );
        });
        // console.log("existingPorterParts number creeps",porters.length);
        parts = 0;
        for (var i in porters) {
            parts = parts + porters[i].getActiveBodyparts(WORK);
        }
        //   console.log("existingPorterParts  parts",parts);
        return parts;
    },

    porterShortfall: function (room,currentPolicy) {
        //var porterSize = this.porterSize(room);
        var existingPorterParts = this.existingPorterParts(currentPolicy);

        //var externalCommitments = poolSupply.getEnergyInBuildQueue();

        var energyInStorage;
        if ( room.storage !== undefined) {
            energyInStorage = room.storage.store[RESOURCE_ENERGY];
        } else {
            energyInStorage = 0;
        }
        var portersNoCommitmentsEnergyLT = roomOwned.energyLifeTime(room, 1, gc.ROLE_FLEXI_STORAGE_PORTER);
        var sourceEnergyLT  = roomOwned.allSourcesEnergy(room) *5;
        var energyBuildLinkersAndRepairer = 4*1000;
        var energyForUpgrading = sourceEnergyLT - energyBuildLinkersAndRepairer;// - externalCommitments;
        var numPortersPartsNeeded = Math.max(5,energyForUpgrading / portersNoCommitmentsEnergyLT);

        var extraPartsForStorage = existingPorterParts - numPortersPartsNeeded;
        // console.log("extraPartsForStorage",extraPartsForStorage,"existingPorterParts"
        //                  ,existingPorterParts,"numPortersPartsNeeded",numPortersPartsNeeded);

        var availableInStorage = Math.max(0, energyInStorage - gc.STORAGE_STOCKPILE - extraPartsForStorage * portersNoCommitmentsEnergyLT);
        //    console.log("available InStorage",availableInStorage,"energyInStorage",energyInStorage,"extraPartsForStorage",
        //                     extraPartsForStorage,"portersNoCommitmentsEnergyLT",portersNoCommitmentsEnergyLT);

        energyForUpgrading = sourceEnergyLT - energyBuildLinkersAndRepairer + availableInStorage ;//externalCommitments
        numPortersPartsNeeded = Math.max(5,energyForUpgrading / portersNoCommitmentsEnergyLT);
        //console.log("porterShortfall number of parts needed", numPortersPartsNeeded);

        var porterShortfall = numPortersPartsNeeded - existingPorterParts;
        //  console.log(room,"many2one portorparts",numPortersPartsNeeded);
        //*policy.creepsAgeFactor(currentPolicy);

        /*
         console.log("existingPorterParts",existingPorterParts,"externalCommitments",externalCommitments);
         console.log("portersNoCommitmentsEnergyLT",portersNoCommitmentsEnergyLT,"sourceEnergyLT",sourceEnergyLT
         ,"energyBuildLinkersAndRepairer",energyBuildLinkersAndRepairer);

         console.log("energyForUpgrading",energyForUpgrading,"sourceEnergyLT",sourceEnergyLT,
         "energyBuildLinkersAndRepairer",energyBuildLinkersAndRepairer,"externalCommitments",externalCommitments,
         "energyInStorage",energyInStorage);
         console.log("numPortersPartsNeeded",numPortersPartsNeeded,"energyForUpgrading",energyForUpgrading,
         "portersNoCommitmentsEnergyLT",portersNoCommitmentsEnergyLT);
         console.log(room,"porterShortfall",porterShortfall,"numPortersPartsNeeded",numPortersPartsNeeded,"existingPorterParts"
         ,existingPorterParts,"age factor",policy.creepsAgeFactor(currentPolicy));
         */
        return porterShortfall;
    },
};



module.exports = economyLinkers;

/*
 attachFlaggedKeeperLairRoutes: function(room, policy) {
 if (room.controller.level < gc.KEEPER_HARVEST_MIN_CONTROLLER_LEVEL)
 return;
 var keeperPolicies = _.filter(Memory.policies, function (policy) {
 return ( (policy.type == gc.POLICY_KEEPER_SECTOR_MARSHAL
 || policy.type == gc.POLICY_KEEPER_SECTOR_ATTACK
 || policy.type == gc.POLICY_KEEPER_SECTOR_AFTER_ACTION
 || policy.type == gc.POLICY_KEEPER_SECTOR_SUPPRESS)
 && policy.keeperRoom == room.name);
 });
 if (!keeperPolicies) return;
 for ( var i = 0 ; i < keeperPolicies.length ; i++ ) {
 this.keeperRoomSendSolders(room, keeperPolicies[i])
 if (keeperPolicies[i].roomCleared) {
 var flags = _.filter(Game.flags, function (flag) {
 return ( flag.memory.policyId == keeperPolicies[i].id);
 });
 for ( var j = 0 ; j < flags.length ;  j ++ ) {
 switch (flag.memory.type) {
 case gc.FLAG_SOURCE:
 this.keeperRoomSendHarvesters(room, policy, flags[j]);
 this.keeperRoomSendPorters(room, policy, flag[j]);
 break;
 case gc.FLAG_MINERAL:
 this.keeperRoomSendMiners(room, policy, flag[j]);
 break;
 default:
 } // switch
 } // for j
 } else {
 var gifts = routeBase.filterBuilds(room, "policy", keeperPolicies[i].id);
 for ( var k = 0 ; k < gifts.length ; k++ ){
 routeBase.removeRoute(gifts[k].id);
 }
 } // if (policy.roomCleared)
 } // for i
 },


 keeperRoomSendHarvesters: function(room, policy, flag) {
 var gifts = routeBase.filterBuildsF(room, function(build) {
 return build.policy == flag.memory.policyId && build.role == gc.ROLE_LINKER;
 });
 if (gifts.length == 0) {
 var order = new RouteLinker( room.name, flag.name, policy.id );
 routeBase.attachRoute(room, gc.ROLE_GIFT, order, gc.PRIORITY_KEEPER_HARVEST);
 }
 },

 keeperRoomSendPorters: function(room, policy, flag) {
 var gifts = routeBase.filterBuildsF(room, function(build) {
 return build.policy == flag.memory.policyId && build.role == gc.ROLE_NEUTRAL_PORTER;
 });
 if (gifts.length == 0) {
 var order = new RouteLinker( room.name, flag.name, policy.id );
 routeBase.attachRoute(room, gc.ROLE_GIFT, order, gc.PRIORITY_KEEPER_PORTER);
 }
 },

 keeperRoomSendMiners: function(room, flag) {
 // TODO Mine minerals in cleared keeper rooms.
 },
 */




















