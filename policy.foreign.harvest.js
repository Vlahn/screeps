/**
 * @fileOverview Screeps module. Abstract object for handling the foreign 
 * harvest policy. 
 * @author Piers Shepperson
 */
 policy = require("policy");

/**
 * Abstract object to support the policy of minig a source in an unoccumpied 
 * room
 * @module policy
 */
var policyForeignHarvest = {

    adaptPolicy: function (room, foreignRoom, supportLevel) {
        if (room.memory.policy === undefined) {
            room.memory.policy = [];
        }
        var newPolicy = {   policy: policy.Type.FOREIGN_HARVEST,
                            foriegnRoom: foreignRoom.name,
                            workerSupport: supportLevel,
                            buldRoad: true,
                        } 
        room.memory.policy.push(newPolicy);
    },

    draftNewPolicyId: function(room)
    {
        policyPeace = require("policy.peace");        
        if (undefined === room.controller   || false != room.controller.my)
        {
            return policy.Type.FOREIGN_HARVEST;
        } else {

            return policyPeace.draftNewPolicyId(room);
        }
    },

    enactPolicy: function(room) {
        raceBase.moveCreeps(room);
    }

}

module.exports = policyForeignHarvest;