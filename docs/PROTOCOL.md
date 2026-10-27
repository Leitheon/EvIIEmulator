# Evony client protocol (EvonyClient1921.swf, version 091103_11)

Generated from the decompiled client by tools/extract_protocol.py. Do not edit by hand.

## Wire format

- TCP socket, default port 443. Before connecting, Flash asks for a socket policy file (port 843, or the URL in config2.xml `<security>`).
- Each message: 4-byte big-endian length, then an AMF3-encoded object `{cmd: String, data: Object}`.
- Server to client only: if the top bit of the length is set, the payload is zlib-compressed (ByteArray.uncompress).
- On connect the client sends `gameClient.version` with data `"091103_11"`. The server may answer `gameClient.errorVersion` or `gameClient.kickout`.
- Replies to a request reuse the request's `cmd`; unsolicited pushes use `server.<Event>`.

## Requests (301)

### AllianceCommands

| cmd | params | reply bean |
|---|---|---|
| `alliance.getAllianceArmyReport` | armyId:int | AllianceArmyResponse |
| `alliance.getAllianceEventList` | pageNo:int | AllianceEventListResponse |
| `alliance.getAllianceInfo` | allianceName:String | AllianceInfoResponse |
| `alliance.getAllianceList` | pageSize:int, pageNum:int, ranking:int, name:String | AllianceListResponse |
| `alliance.getAllianceMembers` | — | AllianceMembersResponse |
| `alliance.getMilitarySituationList` | pageNo:int, pageSize:int | MilitarySituationListResponse |

### AllianceManagementCommands

| cmd | params | reply bean |
|---|---|---|
| `alliance.addUsertoAlliance` | userName:String | AllianceManagementResponse |
| `alliance.addUsertoAllianceList` | — | AllianceInviteBeanResponse |
| `alliance.agreeComeinAllianceByLeader` | userName:String | AllianceManagementResponse |
| `alliance.agreeComeinAllianceByUser` | castleId:int, allianceName:String | AllianceUserAddResponse |
| `alliance.agreeComeinAllianceList` | — | AllianceUserAddResponse |
| `alliance.cancelUserWantInAlliance` | allianceName:String | AllianceManagementResponse |
| `alliance.canceladdUsertoAlliance` | userName:String | AllianceInviteBeanResponse |
| `alliance.cancelagreeComeinAlliance` | userName:String | AllianceUserAddResponse |
| `alliance.createAlliance` | castleId:int, allianceName:String | AllianceManagementResponse |
| `alliance.dropAllianceFriendshipRelation` | targetAllianceName:String | AllianceFriendshipResponse |
| `alliance.getAllianceFriendshipList` | — | AllianceFriendshipResponse |
| `alliance.getAllianceWanted` | — | WantedAllianceResponse |
| `alliance.getPowerFromAlliance` | — | AlliancePowerLevelResponse |
| `alliance.isHasAlliance` | — | HasAllianceResponse |
| `alliance.kickOutMemberfromAlliance` | userName:String | AllianceManagementResponse |
| `alliance.leaderWantUserInAllianceList` | — | AllianceInviteOnClientBeanResponse |
| `alliance.messagesForAllianceMember` | title:String, message:String, type:int | AllianceManagementResponse |
| `alliance.rejectComeinAlliance` | allianceName:String | AllianceUserAddResponse |
| `alliance.resetTopPowerForAlliance` | userName:String | AllianceManagementResponse |
| `alliance.resignForAlliance` | — | AllianceManagementResponse |
| `alliance.sayByetoAlliance` | — | AllianceManagementResponse |
| `alliance.setAllInfoForAlliance` | allianceName:String, infoText:String, noteText:String | AllianceManagementResponse |
| `alliance.setAllianceFriendship` | targetAllianceName:String, type:int | AllianceManagementResponse |
| `alliance.setPowerForUserByAlliance` | userName:String, typeId:int | AllianceManagementResponse |
| `alliance.userWantInAlliance` | allianceName:String | AllianceManagementResponse |

### ArmyCommands

| cmd | params | reply bean |
|---|---|---|
| `army.IsDropItemInCastle` | x:int, y:int | CommandResponse |
| `army.callBackArmy` | castleId:int, armyId:int | CommandResponse |
| `army.cureInjuredTroop` | castleId:int | CommandResponse |
| `army.disbandFleeTroop` | castleId:int | CommandResponse |
| `army.disbandInjuredTroop` | castleId:int | CommandResponse |
| `army.exerciseArmy` | castleId:int, troopParamAttack:any, troopParamDefend:any | ArmyPracticeResponse |
| `army.getFleeTroop` | castleId:int | CommandResponse |
| `army.getInjuredTroop` | castleId:int | CommandResponse |
| `army.getStayAllianceArmys` | castleId:int | StayAllianceReponse |
| `army.getTroopParam` | castleId:int | TroopParamResponse |
| `army.newArmy` | castleId:int, newArmyBean:any | CommandResponse |
| `army.recruitFleeTroop` | castleId:int | CommandResponse |
| `army.setAllowAllianceArmy` | castleId:int, isAllow:Boolean | CommandResponse |
| `army.setArmyGoOut` | castleId:int, isArmyGoOut:Boolean | CommandResponse |

### CapitalCommands

| cmd | params | reply bean |
|---|---|---|
| `capital.getLeftPoliciesTimes` | castleId:int | CapitalCommandResponse |
| `capital.getUsedPoliciesTimes` | castleId:int | CapitalCommandResponse |
| `capital.levyArmy` | castleId:int, targetFieldId:int | CapitalCommandResponse |
| `capital.levyFood` | castleId:int, targetFieldId:int | CapitalCommandResponse |
| `capital.levyPopulation` | castleId:int, targetFieldId:int | CapitalCommandResponse |
| `capital.levyTaxes` | castleId:int, targetFieldId:int | CapitalCommandResponse |
| `capital.reduceArmaments` | castleId:int, targetFieldId:int | CapitalCommandResponse |

### CastleCommands

| cmd | params | reply bean |
|---|---|---|
| `castle.UpdateCastleResources` | castleId:int | AvailableBuilingListResponse |
| `castle.cancelBuildingQueue` | castleId:int, queueId:int | CommandResponse |
| `castle.cancleBuildCommand` | castleId:int, positionId:int | CommandResponse |
| `castle.checkOutUpgrade` | castleId:int, positionId:int | CheckOutBuildingResponse |
| `castle.demolishBuildingQueue` | castleId:int, type:int, level:int, positionId:int | CommandResponse |
| `castle.destructBuilding` | castleId:int, positionId:int | CommandResponse |
| `castle.getAvailableBuildingBean` | castleId:int, typeId:int | AvailableBuilingListResponse |
| `castle.getAvailableBuildingListInside` | castleId:int | AvailableBuilingListResponse |
| `castle.getAvailableBuildingListOutside` | castleId:int | AvailableBuilingListResponse |
| `castle.getBuildingQueueCoinsNeed` | castleId:int, queueId:int | CoinsNeedResponse |
| `castle.getCoinsNeed` | castleId:int, positionId:int | CoinsNeedResponse |
| `castle.getDestructBuildBean` | castleId:int, positionId:int | AvailableBuilingListResponse |
| `castle.newBuilding` | castleId:int, positionId:int, buildingType:int | CommandResponse |
| `castle.newBuildingQueue` | castleId:int, type:int, level:int, positionId:int | CommandResponse |
| `castle.speedUpBuildCommand` | castleId:int, positionId:int, itemId:String | CommandResponse |
| `castle.speedupBuildingQueue` | castleId:int, queueId:int, itemId:String | CommandResponse |
| `castle.upgradeBuilding` | castleId:int, positionId:int | CommandResponse |

### CastleSignCommand

| cmd | params | reply bean |
|---|---|---|
| `castle.deleteCastleSign` | id:int | CastleSignResponse |
| `castle.saveCastleSignList` | id:int, x:int, y:int | CastleSignResponse |

### CelebRankCommands

| cmd | params | reply bean |
|---|---|---|
| `celeb.findAllianceByPrestige` | prestige:String | CelebResponse |
| `celeb.findPlayerByPrestige` | prestige:String | CelebResponse |
| `celeb.findPlayerByStar` | starlv:int | CelebResponse |
| `celeb.findPlayerByTitle` | title:String | CelebResponse |

### CityCommands

| cmd | params | reply bean |
|---|---|---|
| `city.WarMoveCastle` | castleId:int, targetId:int | CommandResponse |
| `city.advMoveCastle` | castleId:int, targetId:int | CommandResponse |
| `city.constructCastle` | castleId:int, fieldId:int, isTroopBack:Boolean | CommandResponse |
| `city.getStoreList` | castleId:int | StoreListResponse |
| `city.giveupCastle` | password:String, castleId:int | CommandResponse |
| `city.modifyCastleIcon` | castleId:int, icon:int | CommandResponse |
| `city.modifyCastleName` | castleId:int, name:String, logUrl:String | CommandResponse |
| `city.modifyFlag` | newFlag:String | CommandResponse |
| `city.modifyStorePercent` | castleId:int, foodrate:int, woodrate:int, stonerate:int, ironrate:int | CommandResponse |
| `city.modifyUserName` | userName:String, itemId:String | CommandResponse |
| `city.moveCastle` | castleId:int, zoneId:int | CommandResponse |
| `city.setStopWarState` | ItemId:String, passWord:String | CommandResponse |
| `city.uniteAdvMoveCastle` | castleId:int, targetId:int | CommandResponse |

### ColonyCommands

| cmd | params | reply bean |
|---|---|---|
| `colony.abandonColony` | castleId:int, targetCastleId:int | CommandResponse |
| `colony.getColonialArmyInfo` | castleId:int, targetCastleId:int | ColonialArmyResponse |
| `colony.getColonialCastlesInfo` | castleId:int | ColonialCastlesRespone |
| `colony.getDeployTroopsInfo` | castleId:int, targetCastleId:int | ColonialDeployResponse |
| `colony.getSuzerainColonialCastlesInfo` | castleId:int | ColonialCastlesRespone |
| `colony.levyArmy` | castleId:int, targetCastleId:int | ColonyLevyeRespone |
| `colony.levyFood` | castleId:int, targetCastleId:int | ColonyLevyeRespone |
| `colony.levyPopulation` | castleId:int, targetCastleId:int | ColonyLevyeRespone |
| `colony.levyTaxes` | castleId:int, targetCastleId:int | ColonyLevyeRespone |
| `colony.overviewColonialCastle` | castleId:int, targetCastleId:int | OverviewColonyCastleRespone |
| `colony.reduceArmaments` | castleId:int, targetCastleId:int | ColonyLevyeRespone |
| `colony.setDeployTroops` | castleId:int, targetCastleId:int, troopBean:any | CommandResponse |
| `colony.sowDiscord` | castleId:int, targetCastleId:int | CommandResponse |
| `colony.speedUpAbandonColony` | castleId:int, targetCastleId:int, itemId:String | CommandResponse |
| `colony.uprise` | castleId:int | CommandResponse |

### CommissionQuestCommands

| cmd | params | reply bean |
|---|---|---|
| `commission.acceptCommissionQuest` | castleId:int, questId:int, newArmyBean:any | CommandResponse |
| `commission.addCommissionQuestArmy` | castleId:int, questId:int, newArmyBean:any | CommandResponse |
| `commission.declineCommissionQuest` | questId:int | CommandResponse |
| `commission.getAllCommissionQuest` | — | CommissionQuestRespone |
| `commission.getCommissionQuestArmyInfo` | questId:int, playerId:int | CommissionQuestArmyInfoRespone |
| `commission.getCommissionQuestArmyRanking` | questId:int | CommissionQuestArmyRespone |
| `commission.getMyAcceptedCommissionQuest` | — | CommissionQuestRespone |
| `commission.getMyCommissionQuest` | — | CommissionQuestRespone |
| `commission.issueCommissionQuest` | castleId:int, type:int, targetX:int, targetY:int, reward:int | CommandResponse |

### CommonCommands

| cmd | params | reply bean |
|---|---|---|
| `common.addToFavorites` | — | CommandResponse |
| `common.allianceChat` | msg:String, languageType:int | ChatResponse |
| `common.changeHeadline` | headline:String | CommandResponse |
| `common.changeName` | type:int, nowName:String, newName:String | ChangeNameResponse |
| `common.changeUserFace` | faceUrl:String, sex:int | ChangeUserFaceResponse |
| `common.channelChat` | channel:String, sendMsg:String, languageType:int | ChatResponse |
| `common.createNewPlayer` | userName:String, sex:int, faceUrl:String, flag:String, castleName:String, zone:int, accountName:String | CreatePlayerResponse |
| `common.declaredWarAgainstPlayer` | playerId:int | CommandResponse |
| `common.delUniteServerPeaceStatus` | — | CommandResponse |
| `common.deleteUserAndRestart` | pwd:String | CommandResponse |
| `common.denyPlayerSpeak` | playername:String, time:int | CommandResponse |
| `common.facebookConnect` | facebookId:String, password:String, fbsig:String | CommandResponse |
| `common.getCanDeclaredWarAgainstPlayer` | playerId:int | GetCanDeclaredWarAgainstPlayerRespone |
| `common.getItemDefXml` | — | GetItemDefResponse |
| `common.getPackage` | ruleId:int, serial:String | GetPackageResponse |
| `common.getPackageList` | — | GetPackageListResponse |
| `common.getPackageNumber` | — | GetPackageNumberResponse |
| `common.getPlayerDeclaredWarStatus` | playerId:int | GetDeclaredWarResponse |
| `common.getPlayerInfoByName` | userName:String | PlayerInfoResponse |
| `common.getRelationship` | playerId:int | GetRelationshipRespone |
| `common.mapCastle` | castleId:int, x1:int, y1:int, x2:int, y2:int | MapCastleResponse |
| `common.mapInfo` | castleId:int, x1:int, y1:int, x2:int, y2:int | MapInfoResponse |
| `common.mapInfoSimple` | castleId:int, x1:int, y1:int, x2:int, y2:int | MapInfoSimpleResponse |
| `common.privateChat` | targetName:String, msg:String | ChatResponse |
| `common.saveUnregisteredPlayer` | account:String, password:String | CommandResponse |
| `common.setAutoHeal` | autoHeal:Boolean | CommandResponse |
| `common.setEovnyMember` | — | CommandResponse |
| `common.setEventDone` | id:int | CommandResponse |
| `common.setEvonyMemberEMail` | email:String | CommandResponse |
| `common.setReceiveIncomingAttack` | isAccept:Boolean | CommandResponse |
| `common.setReturnReport` | returnReport:Boolean | CommandResponse |
| `common.setTroopConfig` | name:String, config:any | TroopConfigResponse |
| `common.step` | tutorialStepId:int | CommandResponse |
| `common.worldChat` | msg:String, languageType:int | ChatResponse |
| `common.zoneInfo` | — | ZoneInfoResponse |

### EquipmentCommands

| cmd | params | reply bean |
|---|---|---|
| `equipment.EnhancedByGemStone` | gemstoneid:String, pos:int, lv:int | GemstoneRespone |
| `equipment.EnhancedStarByGemStone` | gemstoneid:String, count:int, pos:int | GemstoneRespone |
| `equipment.TakeOffAllEquipmenttech` | heroid:int | CommandResponse |
| `equipment.TakeOffEquipmenttech` | heroid:int, Equipmenttechid:String, pos:int | CommandResponse |
| `equipment.WearAllEquipmenttech` | heroid:int, AddAttributeType:int | CommandResponse |
| `equipment.WearEquipmenttech` | heroid:int, Equipmenttechid:String, AddAttributeType:int, pos:int | CommandResponse |

### EquipmenttechCommands

| cmd | params | reply bean |
|---|---|---|
| `equipmenttech.cancelResearch` | castleId:int | CommandResponse |
| `equipmenttech.getCoinsNeed` | castleId:int | CoinsNeedResponse |
| `equipmenttech.getResearchList` | castleId:int | AvailableResearchListResponse |
| `equipmenttech.research` | castleId:int, techId:int | ResearchResponse |
| `equipmenttech.speedUpResearch` | castleId:int, itemId:String | ResearchResponse |

### FieldCommand

| cmd | params | reply bean |
|---|---|---|
| `field.getCastleFieldInfo` | castleId:int | CastleFieldInfoResponse |
| `field.getOtherFieldInfo` | castleId:int, fieldId:int | OtherFieldInfoResponse |
| `field.giveUpField` | fieldId:int | CommandResponse |

### FortificationsCommands

| cmd | params | reply bean |
|---|---|---|
| `fortifications.accTroopProduce` | castleId:int, queueId:int, itemId:String | CommandResponse |
| `fortifications.cancelFortificationProduce` | castleId:int, queueId:int | CommandResponse |
| `fortifications.destructWallProtect` | castleId:int, typeId:int, num:int | CommandResponse |
| `fortifications.getFortificationsProduceList` | castleId:int | FortProduceListResponse |
| `fortifications.getProduceQueue` | castleId:int | ProduceQueueResponse |
| `fortifications.produceWallProtect` | castleId:int, wallProtectType:int, num:int | CommandResponse |

### FriendCommands

| cmd | params | reply bean |
|---|---|---|
| `friend.addBlock` | player:String | FriendResponse |
| `friend.addFriend` | player:String | FriendResponse |
| `friend.deleteBlock` | player:String | FriendResponse |
| `friend.deleteFriend` | player:String | FriendResponse |
| `friend.isBlockMailPlayer` | mailId:int | FriendResponse |

### FurloughCommands

| cmd | params | reply bean |
|---|---|---|
| `furlough.cancelFurlought` | playerId:int | FurloughResponse |
| `furlough.isFurlought` | playerId:int, day:int, password:String, isAutoFurlough:Boolean | FurloughResponse |

### GamblingRankingCommands

| cmd | params | reply bean |
|---|---|---|
| `gamblingranking.getGamblingRankingReward` | — | GamblingRankingRewardRespone |
| `gamblingranking.getGamblingRankingToday` | pageNo:int, pageSize:int | GamblingRankingRespone |
| `gamblingranking.getGamblingRankingYesterday` | pageNo:int, pageSize:int | GamblingRankingRespone |

### HeroCommand

| cmd | params | reply bean |
|---|---|---|
| `hero.GenSaveRandomHero` | castleid:int, heroname:String, faceurl:String | CommandResponse |
| `hero.GetDisappearHeros` | — | DisappearHeroResponse |
| `hero.GetRandomHero` | — | RandomHeroResponse |
| `hero.RecoverDisappearHero` | castleid:int, id:String | CommandResponse |
| `hero.RetSetHeroAttri` | lockmanagement:Boolean, lockpower:Boolean, lockstratagem:Boolean, busecoin:Boolean | RandomHeroResponse |
| `hero.SetShowHeroId` | heroid:int, bAddOrDel:Boolean | SetShowInfroResponse |
| `hero.ShowPlayerHerosByUserName` | UserName:String | HeroListResponse |
| `hero.addPoint` | castleId:int, heroId:int, management:Number, power:Number, stratagem:Number | CommandResponse |
| `hero.addPoint2` | castleId:int, heroId:int, management:int, power:int, stratagem:int | CommandResponse |
| `hero.awardGold` | castleId:int, heroId:int | CommandResponse |
| `hero.callBackHero` | castleId:int, heroId:int | CommandResponse |
| `hero.changeName` | castleId:int, heroId:int, newName:String | CommandResponse |
| `hero.dischargeChief` | castleId:int | CommandResponse |
| `hero.fireHero` | castleId:int, heroId:int | CommandResponse |
| `hero.getFleeHeroList` | castleId:int | HeroListResponse |
| `hero.getHerosListFromTavern` | castleId:int | HeroListResponse |
| `hero.hireFacebookFriendHero` | castleId:int, heroName:String, newName:String, facebookid:String | CommandResponse |
| `hero.hireHero` | castleId:int, heroName:String | CommandResponse |
| `hero.levelUp` | castleId:int, heroId:int | CommandResponse |
| `hero.promoteToChief` | castleId:int, heroId:int | CommandResponse |
| `hero.recruitFleeHero` | castleId:int, heroName:String | CommandResponse |
| `hero.refreshHerosListFromTavern` | castleId:int | HeroListResponse |
| `hero.releaseHero` | castleId:int, heroId:int | CommandResponse |
| `hero.resetPoint` | castleId:int, heroId:int | CommandResponse |
| `hero.setHeroFacebookId` | castleId:int, heroId:int, facebookId:String | CommandResponse |
| `hero.tryGetSeizedHero` | castleId:int, heroId:int | CommandResponse |
| `hero.useItem` | castleId:int, heroId:int, itemId:String | CommandResponse |

### InteriorCommands

| cmd | params | reply bean |
|---|---|---|
| `interior.getResourceProduceData` | castleId:int | ResourceProduceDataResponse |
| `interior.modifyCommenceRate` | castleId:int, foodrate:int, woodrate:int, stonerate:int, ironrate:int | CommandResponse |
| `interior.modifyTaxRate` | castleId:int, tax:int | CommandResponse |
| `interior.pacifyPeople` | castleId:int, typeId:int | CommandResponse |
| `interior.taxation` | castleId:int, typeId:int | CommandResponse |

### MailCommands

| cmd | params | reply bean |
|---|---|---|
| `mail.deleteMail` | str_mailid:String | CommandResponse |
| `mail.getAllTVMsg` | — | TVResponse |
| `mail.readMail` | mailId:int | MailResponse |
| `mail.readOverMailList` | mailIds:String | MailResponse |
| `mail.receiveMailList` | pageNo:int, type:int, pageSize:int | MailListResponse |
| `mail.reportBug` | subject:String, content:String | CommandResponse |
| `mail.reportPlayer` | subject:String, content:String | CommandResponse |
| `mail.sendMail` | username:String, title:String, content:String | CommandResponse |

### ModifyCommands

| cmd | params | reply bean |
|---|---|---|
| `gamemaster.addBuilding` | castleId:int, buildingType:int, position:int, level:int | CommandResponse |
| `gamemaster.addHero` | castleId:int, name:String, level:int, experience:int, loyalty:int, status:int, management:int, power:int, stratagem:int, remain:int | CreateHeroResponse |
| `gamemaster.addItems` | type:String, amount:int | CommandResponse |
| `gamemaster.removeBuilding` | castleId:int, position:int | CommandResponse |
| `gamemaster.removeHero` | castleId:int, heroId:int | CommandResponse |
| `gamemaster.removeItem` | type:String | CommandResponse |
| `gamemaster.setResources` | castleId:int, wood:int, iron:int, stone:int, food:int, gold:int, population:int | CommandResponse |
| `gamemaster.setTechnology` | technologyType:int, level:int | CommandResponse |

### NpcHeroCommand

| cmd | params | reply bean |
|---|---|---|
| `npchero.getNpcHeroInfroByID` | npcid:int, castleId:int | NpcHeroListResponse |
| `npchero.getNpcHerosList` | castleId:int | NpcHeroListResponse |
| `npchero.getNpcHerosListByFilter` | filter:String, castleId:int | NpcHeroListResponse |
| `npchero.getNpcHerosListByMoney` | castleId:int | NpcHeroListResponse |

### QuestCommands

| cmd | params | reply bean |
|---|---|---|
| `quest.AllowRegister` | — | CommandResponse |
| `quest.abandon` | questid:int, castleid:int | CommandResponse |
| `quest.accept` | ncpid:int, castleid:int | QuestListResponse |
| `quest.award` | castleId:int, questId:int | CommandResponse |
| `quest.awardPacket` | castleId:int, questId:int, key:String | CommandResponse |
| `quest.donate` | questid:int, castleid:int | CommandResponse |
| `quest.getAwardItems` | questId:int | QuestRewardRespone |
| `quest.getEffortList` | castleId:int | EffortListResponse |
| `quest.getEffortListByTargeTypeid` | castleId:int, TargeTypeid:int | QuestListResponse |
| `quest.getQuestList` | castleId:int, typeId:int | QuestListResponse |
| `quest.getQuestType` | castleId:int, type:int | QuestTypeResponse |

### RankCommands

| cmd | params | reply bean |
|---|---|---|
| `rank.getAllianceRank` | key:String, pageNo:int, pageSize:int, sortType:int | RankAllianceResponse |
| `rank.getCastleRank` | key:String, pageNo:int, pageSize:int, sortType:int | RankCastleResponse |
| `rank.getHeroRank` | key:String, pageNo:int, pageSize:int, sortType:int | RankHeroResponse |
| `rank.getPlayerRank` | key:String, pageNo:int, pageSize:int, sortType:int | RankPlayerResponse |
| `rank.getTopVotesPlayer` | — | TopVotesPlayersResponse |
| `rank.getVoteRank` | key:String, pageNo:int, pageSize:int, sortType:int | RankPlayerVotesResponse |

### ReportCommands

| cmd | params | reply bean |
|---|---|---|
| `report.deleteAllReports` | reportType:int | CommandResponse |
| `report.deleteReport` | idStr:String | CommandResponse |
| `report.markAsRead` | reportId:int | ReportResponse |
| `report.readOverReport` | reportIds:String | ReportResponse |
| `report.receiveReportList` | pageNo:int, pageSize:int, reportType:int | ReportListResponse |
| `report.shareReport` | reportId:int | ShareReportResponse |

### SecurityCommands

| cmd | params | reply bean |
|---|---|---|
| `common.authSecurityCode` | code:String | CommandResponse |
| `common.cancelRemovingSecurityCodeProcess` | — | CommandResponse |
| `common.changeSecurityCode` | curCode:String, newCode:String | CommandResponse |
| `common.getIsSecurityCodeSetted` | — | GetIsSecurityCodeSettedResponse |
| `common.getProtectOption` | — | GetProtectOptionResponse |
| `common.removeSecurityCode` | — | CommandResponse |
| `common.setProtectOption` | option:int | CommandResponse |
| `common.setSecurityCode` | code:String | CommandResponse |
| `common.setUnlockOption` | option:int | CommandResponse |

### ShopCommands

| cmd | params | reply bean |
|---|---|---|
| `shop.Gem_Smelting` | itemId:String, bookitemId:String | CommandResponse |
| `shop.buy` | itemId:String, amount:int | CommandResponse |
| `shop.buyResource` | castleId:int, foodUse:int, woodUse:int, ironUse:int, stoneUse:int | CommandResponse |
| `shop.getBuyResourceInfo` | castleId:int | BuyResourceInfoResponse |
| `shop.useAngelItem` | playername:String, itemId:String | CommandResponse |
| `shop.useCastleGoods` | castleId:int, itemId:String | CommandResponse |
| `shop.useDevilItem` | x:int, y:int, itemId:String, paramdata:String | CommandResponse |
| `shop.useGoods` | castleId:int, itemId:String, num:int | UseItemResultResponse |
| `shop.useTrickItem` | castleId:int, armyid:int, itemId:String | CommandResponse |

### StratagemCommands

| cmd | params | reply bean |
|---|---|---|
| `stratagem.useStratagem` | castleId:int, heroId:int, straId:String | CommandResponse |

### TechCommand

| cmd | params | reply bean |
|---|---|---|
| `tech.cancelResearch` | castleId:int | CommandResponse |
| `tech.getCoinsNeed` | castleId:int | CoinsNeedResponse |
| `tech.getResearchList` | castleId:int | AvailableResearchListResponse |
| `tech.research` | castleId:int, techId:int | ResearchResponse |
| `tech.speedUpResearch` | castleId:int, itemId:String | ResearchResponse |

### TradeCommands

| cmd | params | reply bean |
|---|---|---|
| `trade.cancelTrade` | castleId:int, tradeId:int | CommandResponse |
| `trade.getMyTradeList` | castleId:int | TradeListResponse |
| `trade.getTransingTradeList` | castleId:int | TransingTradeListResponse |
| `trade.newTrade` | castleId:int, resType:int, tradeType:int, amount:int, price:String | CommandResponse |
| `trade.searchTrades` | resType:int | SearchTradesResponse |
| `trade.speedUpTrans` | castleId:int, transingTradeId:int, itemId:String | CommandResponse |

### TroopCommands

| cmd | params | reply bean |
|---|---|---|
| `troop.accTroopProduce` | castleId:int, positionId:int, queueId:int, itemId:String | CommandResponse |
| `troop.cancelTroopProduce` | castleId:int, positionId:int, queueId:int | CommandResponse |
| `troop.checkIdleBarrack` | castleId:int, troopType:int | CommandResponse |
| `troop.disbandTroop` | castleId:int, troopType:int, num:int | CommandResponse |
| `troop.getProduceQueue` | castleId:int | ProduceQueueResponse |
| `troop.getTroopProduceList` | castleId:int, positionId:int | TroopProduceListResponse |
| `troop.produceTroop` | castleId:int, positionId:int, troopType:int, num:int, isShare:Boolean, toIdle:Boolean | CommandResponse |

### TruceCommands

| cmd | params | reply bean |
|---|---|---|
| `truce.cancelDreamTruce` | password:String | CommandResponse |
| `truce.changeDreamTruceTime` | hour:int, minute:int, second:int, password:String | CommandResponse |
| `truce.setDreamTruce` | hour:int, minute:int, second:int, password:String | CommandResponse |

### VisitCommands

| cmd | params | reply bean |
|---|---|---|
| `visit.deleteComment` | id:int | CommandResponse |
| `visit.getAllVisitorComments` | pageNo:int, pageSize:int | GetAllVisitorCommentsResponse |
| `visit.getHelpedPlayers` | — | GetHelpedPlayersResponse |
| `visit.getVisitorComments` | visitorId:String, pageNo:int, pageSize:int | GetAllVisitorCommentsResponse |
| `visit.helpIncreaseProduction` | fromServer:String, fromPlayer:String | CommandResponse |
| `visit.markCommentAsRead` | id:int | CommandResponse |
| `visit.visitorComment` | comment:String | CommandResponse |

### VoteToPlayerCommands

| cmd | params | reply bean |
|---|---|---|
| `vote.voteToPlayerById` | playerId:int | CommandResponse |
| `vote.voteToPlayerByName` | name:String | CommandResponse |

## Server pushes (51)

| cmd | bean |
|---|---|
| `server.AcademyResearchUpdate` | AcademyResearchUpdate |
| `server.AllianceChatMsg` | AllianceChatMsg |
| `server.BuildComplate` | BuildComplate |
| `server.BuildingQueueUpdate` | BuildingQueueUpdate |
| `server.CastleBuffUpdate` | CastleBuffUpdate |
| `server.CastleFieldUpdate` | CastleFieldUpdate |
| `server.CastleUpdate` | CastleUpdate |
| `server.CbUpdate` | CbUpdate |
| `server.CelebRankCompleteTipResponse` | CelebRankCompleteTipResponse |
| `server.ChangeName` | ChangeName |
| `server.ChannelChatMsg` | ChannelChatMsg |
| `server.ColonyUpdate` | ColonyUpdate |
| `server.ConnectionLost` | ConnectionLost |
| `server.DeclaredWarStatusChange` | DeclaredWarStatusChange |
| `server.DeclaredWarUpdate` | DeclaredWarUpdate |
| `server.EnemyArmysUpdate` | EnemyArmysUpdate |
| `server.EquipmentResearchCompleteUpdate` | EquipmentResearchCompleteUpdate |
| `server.FleeTroopUpdate` | FleeTroopUpdate |
| `server.FortificationsUpdate` | FortificationsUpdate |
| `server.FriendArmysUpdate` | FriendArmysUpdate |
| `server.GetPlayerVoteInfro` | GetPlayerVoteInfro |
| `server.GetTopVotesPlayer` | GetTopVotesPlayer |
| `server.HeroUpdate` | HeroUpdate |
| `server.InjuredTroopUpdate` | InjuredTroopUpdate |
| `server.ItemBuff` | ItemBuff |
| `server.ItemUpdate` | ItemUpdate |
| `server.KickedOut` | KickedOut |
| `server.LoginResponse` | LoginResponse |
| `server.MercenaryUpdate` | MercenaryUpdate |
| `server.NewFinishedQuest` | NewFinishedQuest |
| `server.NewMail` | NewMail |
| `server.NewReport` | NewReport |
| `server.PackageList` | PackageList |
| `server.PlayerBuffUpdate` | PlayerBuffUpdate |
| `server.PlayerInfoUpdate` | PlayerInfoUpdate |
| `server.PrivateChatMessage` | PrivateChatMessage |
| `server.QuestCompleteTipResponse` | QuestCompleteTipResponse |
| `server.QuestFinished` | QuestFinished |
| `server.RegisterResponse` | RegisterResponse |
| `server.ResearchCompleteUpdate` | ResearchCompleteUpdate |
| `server.ResourceUpdate` | ResourceUpdate |
| `server.SecurityCodeRemovedEvent` | SecurityCodeRemovedEvent |
| `server.SelfArmysUpdate` | SelfArmysUpdate |
| `server.StrategyBuff` | StrategyBuff |
| `server.SystemInfoMsg` | SystemInfoMsg |
| `server.TradesUpdate` | TradesUpdate |
| `server.TransingTradeUpdate` | TransingTradeUpdate |
| `server.TroopUpdate` | TroopUpdate |
| `server.UnregisteredCreatePlayerResponse` | UnregisteredCreatePlayerResponse |
| `server.VisitorHelpEvent` | VisitorHelpEvent |
| `server.WorldChatMsg` | WorldChatMsg |

## Data classes (223)

### AcademyResearchUpdate (extends BaseBean)

`castleId`:int, `researchBean`:AvailableResearchListBean

### AllProduceBean

`allProduceQueue`:ProduceBean[], `positionId`:int

### AllianceAddPlayerByLeaderInfoBean

`allianceName`:String, `memberCount`:int, `prestige`:int, `rank`:int

### AllianceAddPlayerByUserInfoBean

`castleCount`:int, `inviteTime`:Number, `prestige`:int, `rank`:int, `userName`:String

### AllianceAddPlayerInfoBean

`invitePerson`:String, `inviteTime`:Number, `prestige`:int, `rank`:int, `state`:String, `userName`:String

### AllianceArmyResponse (extends BaseBean)

`armyInfoBean`:BettleResultBean, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### AllianceChatMsg (extends BaseBean)

`fromUser`:String, `languageType`:int, `msg`:String, `ownitemid`:int

### AllianceEvent

`eventName`:String, `time`:Number

### AllianceEventListResponse (extends BaseBean)

`errorMsg`:String, `events`:AllianceEvent[], `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `totalPage`:int

### AllianceFriendshipResponse (extends BaseBean)

`enemyList`:UnitAlliance[], `errorMsg`:String, `friendlyList`:UnitAlliance[], `middleList`:UnitAlliance[], `msg`:String, `ok`:int, `packageId`:Number

### AllianceInfoResponse (extends BaseBean)

`allinaceInfo`:String, `creator`:String, `errorMsg`:String, `leader`:String, `memberCount`:int, `msg`:String, `ok`:int, `packageId`:Number, `prestigeCount`:int, `ranking`:int

### AllianceInviteBeanResponse (extends BaseBean)

`allianceAddPlayerInfoBeanList`:AllianceAddPlayerInfoBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### AllianceInviteOnClientBeanResponse (extends BaseBean)

`allianceAddPlayerByLeaderInfoBeanList`:AllianceAddPlayerByLeaderInfoBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### AllianceListResponse (extends BaseBean)

`alliances`:AllianceQueryBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `totalPage`:int

Constants: ALLIANCE_LIST_NOT_IN_ALLI=-1

### AllianceManagementResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `waitIntoAllianceName`:String

### AllianceMembersResponse (extends BaseBean)

`errorMsg`:String, `members`:PlayerInfoBean[], `msg`:String, `ok`:int, `packageId`:Number

### AlliancePowerLevelResponse (extends BaseBean)

`errorMsg`:String, `level`:int, `msg`:String, `ok`:int, `packageId`:Number

### AllianceQueryBean

`bulletin`:String, `creatorName`:String, `curNum`:int, `desc`:String, `leaderName`:String, `limit`:int, `name`:String, `prestige`:int, `ranking`:int

### AllianceUserAddResponse (extends BaseBean)

`allianceAddPlayerByUserInfoBeanList`:AllianceAddPlayerByUserInfoBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### ArmyBean

`alliance`:String, `armyId`:int, `direction`:int, `hero`:String, `heroLevel`:int, `heroid`:int, `king`:String, `missionType`:int, `reachTime`:Number, `resource`:ResourceBean, `restTime`:Number, `selected`:Boolean, `startFieldId`:int, `startPosName`:String, `startTime`:Number, `targetFieldId`:int, `targetPosName`:String, `troop`:TroopStrBean

### ArmyPracticeResponse (extends BaseBean)

`attackLostTroop`:TroopBean, `defendLostTroop`:TroopBean, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `result`:int, `round`:int

Constants: ARMY_PRACTICE_RESULT_ATTACK_WIN=1, ARMY_PRACTICE_RESULT_GUARD_WIN=-1

### AvailableBuildingListBean

`conditionBean`:ConditionBean, `typeId`:int

### AvailableBuilingListResponse (extends BaseBean)

`builingList`:AvailableBuildingListBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### AvailableResearchListBean

`avalevel`:int, `castleId`:Number, `conditionBean`:ConditionBean, `endTime`:Number, `enhancedstarlv`:int, `help`:int, `level`:int, `permition`:Boolean, `startTime`:Number, `typeId`:int, `upgradeing`:Boolean

### AvailableResearchListResponse (extends BaseBean)

`academyCount`:int, `acailableResearchBeans`:AvailableResearchListBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### BettleResultBean

### BuffBean

`descName`:String, `endTime`:Number, `typeId`:String

### BuildComplate (extends BaseBean)

`buildingBean`:BuildingBean, `castleId`:int

### BuildingBean

`appearance`:int, `endTime`:Number, `help`:int, `level`:int, `name`:String, `positionId`:int, `startTime`:Number, `status`:int, `typeId`:int

### BuildingQueueBean

`costTime`:Number, `id`:int, `level`:int, `name`:String, `positionId`:int, `queueType`:int, `status`:int, `typeId`:int

### BuildingQueueUpdate (extends BaseBean)

`buildingQueueBean`:BuildingQueueBean, `castleId`:int

### BuyResourceBean

`foodRemain`:int, `forFood`:int, `forIron`:int, `forStone`:int, `forWood`:int, `ironRemain`:int, `stoneRemain`:int, `woodRemain`:int

### BuyResourceInfoResponse (extends BaseBean)

`buyResourceBean`:BuyResourceBean, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### CapitalCommandResponse (extends BaseBean)

`amount`:int, `armyType`:String, `castleId`:int, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `targetFieldId`:int

### CastleBean

`allowAlliance`:Boolean, `buffs`:BuffBean[], `buildingQueues`:BuildingQueueBean[], `buildings`:BuildingBean[], `canChangeIcon`:Boolean, `colonization`:int, `colonyBeans`:ColonyBean[], `fieldId`:int, `fields`:FieldBean[], `fortification`:FortificationsBean, `goOutForBattle`:Boolean, `hasEnemy`:Boolean, `heros`:HeroBean[], `icon`:int, `id`:int, `logUrl`:String, `mercenaryBeans`:MercenaryBean[], `name`:String, `powerlevel`:int, `resource`:CastleResourceBean, `status`:int, `strTroop`:TroopStrBean, `trades`:TradeBean[], `transingTrades`:TransingTradeBean[], `troop`:TroopBean, `usePACIFY_SUCCOUR_OR_PACIFY_PRAY`:int, `zoneId`:int

### CastleBuffUpdate (extends BaseBean)

`buffBean`:BuffBean, `castleid`:int, `updateType`:int

### CastleFieldInfoResponse (extends BaseBean)

`errorMsg`:String, `fields`:FieldBean[], `msg`:String, `ok`:int, `packageId`:Number

### CastleFieldUpdate (extends BaseBean)

`bean`:FieldBean, `castleId`:int, `updateType`:int

### CastleResourceBean

`buildPeople`:int, `colonyFood`:Number, `colonyGold`:Number, `colonyIron`:Number, `colonyStone`:Number, `colonyWood`:Number, `complaint`:int, `curPopulation`:int, `food`:ResourceInfoBean, `gold`:Number, `herosSalary`:int, `iron`:ResourceInfoBean, `maxPopulation`:int, `populationDirection`:int, `stone`:ResourceInfoBean, `supplyFood`:Number, `support`:int, `taxIncome`:int, `texRate`:int, `troopCostFood`:Number, `wood`:ResourceInfoBean, `workPeople`:int

### CastleSignInfoBean

`id`:int, `name`:String, `x`:int, `y`:int

### CastleSignResponse (extends BaseBean)

`castleSignInfoArr`:CastleSignInfoBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### CastleUpdate (extends BaseBean)

`castleBean`:CastleBean, `updateType`:int

### CbUpdate (extends BaseBean)

`text`:String, `tp`:int

### CelebRankCompleteTipResponse (extends BaseBean)

`name`:String, `rank`:int

### CelebResponse (extends BaseBean)

`allianceBean`:RankAllianceBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `playerBean`:PlayerInfoBean[]

### ChangeName (extends BaseBean)

`changeType`:int, `errorMsg`:String, `msg`:String, `nowName`:String, `ok`:int, `packageId`:Number

### ChangeNameResponse (extends BaseBean)

`changeType`:int, `errorMsg`:String, `msg`:String, `nowName`:String, `ok`:int, `packageId`:Number

### ChangeUserFaceResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### ChannelChatMsg (extends BaseBean)

`channel`:String, `fromUser`:String, `languageType`:int, `msg`:String, `ownitemid`:int

### ChatResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

Constants: ERROR_MISSING_SPEAKER=-1, ERROR_NO_ALLIANCE=-2, ERROR_NO_USER=-3

### CheckOutBuildingResponse (extends BaseBean)

`conditionBean`:ConditionBean, `desConditionBean`:ConditionBean, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### CoinsNeedResponse (extends BaseBean)

`coinsNeed`:int, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### ColonialArmyResponse (extends BaseBean)

`armyBeans`:ArmyBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### ColonialCastlesRespone (extends BaseBean)

`colonyBeans`:ColonyBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### ColonialDeployResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `reduceCoolDown`:Number, `troopBean`:TroopBean

### ColonyBean

`allianceName`:String, `castleId`:int, `cityName`:String, `endTime`:Number, `isCanLevy`:Boolean, `isCanOverview`:Boolean, `logoUrl`:String, `lordName`:String, `position`:String, `prestige`:int, `relation`:int, `startTime`:Number, `status`:int, `time`:String

### ColonyLevyeRespone (extends BaseBean)

`amount`:int, `armyType`:String, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### ColonyUpdate (extends BaseBean)

`castleId`:int, `colonyBeans`:ColonyBean[]

### CommandResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

Constants: OK_DEFAULT=1, OK_INVALID_REQUEST=-99

### CommissionQuestArmyInfoRespone (extends BaseBean)

`armyBean`:ArmyBean, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### CommissionQuestArmyRankBean

`experience`:Number, `playerId`:int, `rank`:int

### CommissionQuestArmyRespone (extends BaseBean)

`armyRankBean`:CommissionQuestArmyRankBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### CommissionQuestBean

`endtime`:String, `id`:int, `isAccepted`:Boolean, `isFinish`:Boolean, `isMyIssue`:Boolean, `name`:String, `playerCount`:int, `position`:String, `reward`:int, `target`:String, `timeout`:Number, `type`:int

### CommissionQuestRespone (extends BaseBean)

`commissionQuestBean`:CommissionQuestBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### ConditionBean

`buildings`:ConditionDependBuildingBean[], `destructTime`:Number, `food`:int, `gold`:int, `iron`:int, `items`:ConditionDependItemBean[], `population`:int, `stone`:int, `techs`:ConditionDependTechBean[], `time`:Number, `wood`:int

### ConditionDependBuildingBean

`curLevel`:int, `level`:int, `successFlag`:Boolean, `typeId`:int

### ConditionDependItemBean

`curNum`:int, `id`:String, `num`:int, `successFlag`:Boolean

### ConditionDependTechBean

`curLevel`:int, `id`:int, `level`:int, `successFlag`:Boolean

### ConnectionLost (extends BaseBean)

`msg`:String, `reasonCode`:int

Constants: ILLEGAL_NAME=5, KICK_BY_OTHER=3, KICK_BY_SERVER=0, LOGIN_FREQUENTLY=6, SERVER_MAINTAIN=4, SERVER_SHUTDOWN=2, SERVER_START=1

### CreateHeroResponse (extends BaseBean)

`errorMsg`:String, `heroId`:int, `msg`:String, `ok`:int, `packageId`:Number

### CreatePlayerResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `player`:PlayerBean

Constants: CREATE_RESULT_HAVE_CREATED=-3, CREATE_RESULT_NAME_DUP=-1, CREATE_RESULT_ZONE_FULL=-2

### DeclaredWarStatusChange (extends BaseBean)

`status`:int, `userName`:String

### DeclaredWarUpdate (extends BaseBean)

`declaredWarBeans`:PlayerDeclaredWarBean[]

### DisappearHeroBean

`disppeartime`:String, `id`:String, `level`:int, `management`:int, `name`:String, `power`:int, `stratagem`:int

### DisappearHeroResponse (extends BaseBean)

`errorMsg`:String, `heros`:DisappearHeroBean[], `msg`:String, `ok`:int, `packageId`:Number

### EffortListBean

`effortListInfo`:String, `effortTypeid`:int

### EffortListResponse (extends BaseBean)

`effortcomplete`:String, `effortlistbean`:EffortListBean[], `effortpoint`:String, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### EnemyArmysUpdate (extends BaseBean)

`armys`:ArmyBean[]

### EquipmentBean

`addAttribute`:int, `addAttributeType`:int, `equipmenttech`:int, `euipmenttechStarLv`:int, `heroPos`:int, `lv`:int

### EquipmentResearchCompleteUpdate (extends BaseBean)

`castleId`:int, `level`:int, `typeId`:int

### EquipmenttechBean

`equipmenttechid`:int, `lv`:int

### FieldBean

`armys`:ArmyBean[], `id`:int, `level`:int, `name`:String, `statu`:int, `type`:int

### FleeTroopUpdate (extends BaseBean)

`castleId`:int, `goldNeed`:int, `troop`:TroopBean

### FortProduceListBean

`conditionBean`:ConditionBean, `permition`:Boolean, `typeId`:int

### FortProduceListResponse (extends BaseBean)

`errorMsg`:String, `fortList`:FortProduceListBean[], `msg`:String, `ok`:int, `packageId`:Number

### FortificationsBean

`abatis`:int, `arrowTower`:int, `rockfall`:int, `rollingLogs`:int, `trap`:int

### FortificationsUpdate (extends BaseBean)

`castleId`:int, `fortification`:FortificationsBean

### FriendArmysUpdate (extends BaseBean)

`armys`:ArmyBean[]

### FriendResponse (extends BaseBean)

`blockArr`:PlayerInfoBean[], `errorMsg`:String, `friendArr`:PlayerInfoBean[], `msg`:String, `ok`:int, `packageId`:Number

### FurloughResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `playerBean`:PlayerBean

### GamblingItemBean

`count`:int, `id`:String, `kind`:int

### GamblingRankingBean

`count`:int, `isReward`:int, `itemsBeans`:ItemBean[], `playerName`:String, `rank`:int

### GamblingRankingRespone (extends BaseBean)

`errorMsg`:String, `gamblingRankingBeans`:GamblingRankingBean[], `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `totalPage`:int

### GamblingRankingRewardRespone (extends BaseBean)

`errorMsg`:String, `itemBeans`:ItemBean[], `msg`:String, `ok`:int, `packageId`:Number

### GemStoneBean

`gemstoneid`:String

### GemStoneInPosBean

`infro`:GemStoneLvInfroBean[], `pos`:int

### GemStoneLvInfroBean

`gemstoneids`:GemStoneBean[], `lv`:int

### GemstoneRespone (extends BaseBean)

`enhancedstarlv`:int, `equipmenttechid`:int, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### GetAllVisitorCommentsResponse (extends BaseBean)

`commentBeans`:VisitorCommentBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `total`:int, `totalPage`:int

### GetCanDeclaredWarAgainstPlayerRespone (extends BaseBean)

`errorMsg`:String, `isCanDeclaredWar`:Boolean, `msg`:String, `ok`:int, `packageId`:Number

### GetDeclaredWarResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `status`:int

### GetHelpedPlayerBean

`playerFBID`:String

### GetHelpedPlayersResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `players`:GetHelpedPlayerBean[]

### GetIsSecurityCodeSettedResponse (extends BaseBean)

`errorMsg`:String, `isSetSecurityCode`:Boolean, `msg`:String, `ok`:int, `packageId`:Number

### GetItemDefResponse (extends BaseBean)

`errorMsg`:String, `itemXml`:String, `msg`:String, `ok`:int, `packageId`:Number

### GetPackageListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `packages`:PackageBean[]

### GetPackageNumberResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `number`:int, `ok`:int, `packageId`:Number

### GetPackageResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

Constants: ERROR_PACKAGE_EXPIRED=-3, ERROR_PACKAGE_NOT_EXISTS=-1, ERROR_REQUIRMENT_NOT_MET=-2

### GetPlayerVoteInfro (extends BaseBean)

`curdayvotes`:Number

### GetProtectOptionResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `option`:int, `packageId`:Number

### GetRelationshipRespone (extends BaseBean)

`allianceRelation`:int, `canDeclaredWar`:Boolean, `declaredWarStatus`:int, `errorMsg`:String, `freshman`:Boolean, `msg`:String, `ok`:int, `packageId`:Number

### GetTopVotesPlayer (extends BaseBean)

`getvotes`:Number

### HasAllianceResponse (extends BaseBean)

`enemyList`:UnitAlliance[], `errorMsg`:String, `friendlyList`:UnitAlliance[], `indexAllianceInfoBean`:IndexAllianceInfoBean, `middleList`:UnitAlliance[], `msg`:String, `ok`:int, `packageId`:Number, `serialVersionUID`:Number

### HeroBean

`ability`:int, `attack`:Number, `buffs`:BuffBean[], `defence`:int, `equipmentbean`:EquipmentBean[], `experience`:Number, `facebook_id`:String, `fbFriendName`:String, `fieldtype`:int, `id`:int, `infro`:String, `intelligence`:Number, `isHero`:int, `itemAmount`:int, `itemId`:String, `leadership`:int, `leadershipAdded`:int, `level`:int, `logoUrl`:String, `loyalty`:int, `management`:int, `managementAdded`:int, `managementBuffAdded`:int, `maxStrength`:int, `morale`:int, `name`:String, `npc_id`:int, `politics`:Number, `power`:int, `powerAdded`:int, `powerBuffAdded`:int, `remainPoint`:int, `sex`:Boolean, `speed`:int, `stamina`:int, `status`:int, `stratagem`:int, `stratagemAdded`:int, `stratagemBuffAdded`:int, `upgradeExp`:int

### HeroListResponse (extends BaseBean)

`errorMsg`:String, `heros`:HeroBean[], `msg`:String, `ok`:int, `packageId`:Number, `posCount`:int

### HeroUpdate (extends BaseBean)

`castleId`:int, `hero`:HeroBean, `updateType`:int

### IndexAllianceInfoBean

`allianceInfo`:String, `allianceName`:String, `allianceNote`:String, `creatorName`:String, `leaderName`:String, `memberCount`:int, `memberLimit`:int, `prestige`:int, `rank`:int

### InjuredTroopUpdate (extends BaseBean)

`castleId`:int, `goldNeed`:int, `troop`:TroopBean

### ItemBean

`count`:int, `id`:String, `maxCount`:int, `minCount`:int, `name`:String

### ItemBuff (extends BaseBean)

### ItemUpdate (extends BaseBean)

`items`:ItemBean[]

### KickedOut (extends BaseBean)

`ip`:String

### LoginResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `player`:PlayerBean

Constants: LOGIN_RESULT_ERROR_USERNAME=-2, LOGIN_RESULT_NEED_CREATE_PLAYER=-4, LOGIN_RESULT_SERVER_FULL=-3

### MailBean

`isRead`:int, `mailid`:int, `playerId`:int, `receiveTime`:String, `receiver`:String, `selected`:Boolean, `sender`:String, `targetId`:int, `title`:String, `type_id`:int

### MailListResponse (extends BaseBean)

`errorMsg`:String, `mails`:MailBean[], `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `totalPage`:int

### MailResponse (extends BaseBean)

`content`:String, `errorMsg`:String, `isRead`:int, `mailid`:int, `msg`:String, `ok`:int, `packageId`:Number, `playerId`:int, `receiveTime`:String, `receiver`:String, `sender`:String, `targetId`:int, `title`:String, `type_id`:int

### MapCastleBean

`allianceName`:String, `canColonize`:Boolean, `canDeclaredWar`:Boolean, `canLoot`:Boolean, `canOccupy`:Boolean, `canScout`:Boolean, `canSend`:Boolean, `canTrans`:Boolean, `castleIcon`:int, `castleId`:int, `changeface`:int, `colonialRelation`:int, `colonialStatus`:int, `declaredWarStartTime`:Number, `declaredWarStatus`:int, `flag`:String, `freshMan`:Boolean, `furlough`:Boolean, `honor`:int, `id`:int, `name`:String, `npc`:Boolean, `ownerPlayerId`:int, `playerLogoUrl`:String, `powerLevel`:int, `prestige`:int, `relation`:int, `state`:int, `suzerain`:String, `type`:int, `userName`:String, `zoneName`:String

### MapCastleResponse (extends BaseBean)

`castleArray`:MapCastleBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### MapInfoResponse (extends BaseBean)

`castles`:MapCastleBean[], `errorMsg`:String, `mapStr`:String, `msg`:String, `ok`:int, `packageId`:Number, `x1`:int, `x2`:int, `y1`:int, `y2`:int

### MapInfoSimpleResponse (extends BaseBean)

`castles`:MapCastleBean[], `errorMsg`:String, `mapStr`:String, `msg`:String, `ok`:int, `packageId`:Number, `x1`:int, `x2`:int, `y1`:int, `y2`:int

### MarketTradeBean

`amount`:int, `price`:Number

### MercenaryBean

`castleId`:int, `endTime`:Number, `startTime`:Number, `status`:int, `targetPosName`:String

### MercenaryUpdate (extends BaseBean)

`castleId`:int, `mercenaryBean`:MercenaryBean

### MilitarySituation

`attack`:Boolean, `eventName`:String, `id`:int, `otherAllianceName`:String, `startPos`:String, `targetPos`:String, `time`:String, `type`:int, `xml_data`:String

### MilitarySituationListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `situations`:MilitarySituation[], `totalPage`:int

### NewFinishedQuest (extends BaseBean)

### NewMail (extends BaseBean)

`count`:int, `count_inbox`:int, `count_system`:int

### NewReport (extends BaseBean)

`army_count`:int, `count`:int, `other_count`:int, `scout_cout`:int, `trade_count`:int

### NpcHeroBean

`ability`:int, `affairs_base`:int, `bravery_base`:int, `catchQuestId`:int, `face`:int, `field`:int, `hireQuestId`:int, `introduce`:String, `leadership`:int, `leadership_Added`:int, `level`:int, `logoimage`:String, `loyalty`:int, `management`:int, `management_Added`:int, `name`:String, `npcid`:int, `power`:int, `power_Added`:int, `province`:String, `questType`:int, `sex`:int, `status`:int, `stratagem`:int, `stratagem_Added`:int, `taskitemid`:String, `type`:int, `uid`:int, `wisdom_base`:int, `zi`:String

Constants: CATCH_STATUS=1, FREE_STATUS=0, GENERAL_NPC_HERO=0, HIRED_STATUS=2

### NpcHeroListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `npcHeros`:NpcHeroBean[], `ok`:int, `packageId`:Number, `simpleNpcHeros`:SimpleNpcHeroBean[]

### OtherFieldInfoResponse (extends BaseBean)

`bean`:MapCastleBean, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### OverviewColonyCastleRespone (extends BaseBean)

`castleBean`:CastleBean, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### PackageBean

`claimedTime`:String, `desc`:String, `expiredTime`:Number, `id`:int, `isUseNow`:int, `itemList`:ItemBean[], `maxMedal`:int, `minMedal`:int, `packageName`:String, `provideTime`:Number, `scores`:int, `status`:int, `type`:int

Constants: PACKAGE_TYPE_NORMAL=3, PACKAGE_TYPE_SCORES=2, PACKAGE_TYPE_SERIAL=1

### PackageList (extends BaseBean)

### PlayerBean

`autoFurlough`:Boolean, `autoHeal`:Boolean, `blockBeans`:PlayerInfoBean[], `buffs`:BuffBean[], `castleSignBean`:CastleSignInfoBean[], `castles`:CastleBean[], `changedFace`:Boolean, `currentDateTime`:String, `currentTime`:Number, `declaredWarBeans`:PlayerDeclaredWarBean[], `digiId`:String, `disconnectvotes`:Number, `effortPoint`:int, `emailAddress`:String, `enemyArmys`:ArmyBean[], `equipments`:EquipmenttechBean[], `finishedQuestCount`:int, `freshMan`:Boolean, `friendArmys`:ArmyBean[], `friendBeans`:PlayerInfoBean[], `furlough`:Boolean, `furloughDay`:int, `gamblingItemIndex`:int, `gameSpeed`:int, `gemstoneinpos`:GemStoneInPosBean[], `headline`:String, `isEvonyMember`:Boolean, `isReceiveIncomingAttack`:Boolean, `isSetSecurityCode`:Boolean, `items`:ItemBean[], `mapSizeX`:int, `mapSizeY`:int, `newMailCount`:int, `newMaileCount_inbox`:int, `newMaileCount_system`:int, `newReportCount`:int, `newReportCount_army`:int, `newReportCount_other`:int, `newReportCount_scout`:int, `newReportCount_trade`:int, `packageBean`:PackageBean[], `playerInfo`:PlayerInfoBean, `randomEvents`:RandomEventBean[], `redCount`:int, `returnReport`:Boolean, `saleItemBeans`:SaleItemBean[], `saleTypeBeans`:SaleTypeBean[], `selfArmys`:ArmyBean[], `setshowinfro`:SetShowInfro[], `troopConfigBeans`:TroopConfigBean[], `tutorialStepId`:int

### PlayerBuffUpdate (extends BaseBean)

`buffBean`:BuffBean, `updateType`:int

### PlayerDeclaredWarBean

`endTime`:Number, `playerName`:String, `startTime`:Number, `status`:int

### PlayerInfoBean

`accountName`:String, `alliance`:String, `allianceLevel`:String, `bdenyotherplayer`:int, `castleCount`:int, `createrTime`:Number, `date`:String, `effortPoint`:int, `faceUrl`:String, `facebookId`:String, `flag`:String, `getvotes`:Number, `historygetvotes`:Number, `honor`:int, `id`:int, `lastLoginTime`:Number, `levelId`:int, `medal`:int, `office`:String, `population`:int, `prestige`:int, `prweekvotes`:Number, `ranking`:int, `sex`:int, `starlv`:int, `term`:String, `titleId`:int, `topvotes`:Number, `userId`:int, `userName`:String

### PlayerInfoResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `playerInfo`:PlayerInfoBean

### PlayerInfoUpdate (extends BaseBean)

`playerInfo`:PlayerInfoBean

### PrivateChatMessage (extends BaseBean)

`chatType`:int, `fromUser`:String, `msg`:String, `ownitemid`:int

Constants: GM_CHAT=1, NORMAL_CHAT=0

### ProduceBean

`costTime`:Number, `endTime`:Number, `num`:int, `queueId`:int, `type`:int

### ProduceQueueResponse (extends BaseBean)

`allProduceQueue`:AllProduceBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### QuestBean

`award`:String, `description`:String, `isCard`:Boolean, `isFinish`:Boolean, `islast`:Boolean, `manual`:String, `name`:String, `questId`:int, `recommend`:Boolean, `targets`:QuestTargetBean[], `version`:int

### QuestCompleteTipResponse (extends BaseBean)

`name`:String, `quest`:QuestBean, `questId`:int

### QuestFinished (extends BaseBean)

`finishedQuest`:int

### QuestListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `quests`:QuestBean[]

### QuestRewardRespone (extends BaseBean)

`errorMsg`:String, `itemBeans`:ItemBean[], `msg`:String, `ok`:int, `packageId`:Number

### QuestTargetBean

`finished`:Boolean, `name`:String

### QuestTypeBean

`description`:String, `isFinish`:Boolean, `mainId`:int, `name`:String, `recommend`:Boolean, `typeId`:int, `version`:int

### QuestTypeResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `types`:QuestTypeBean[]

### RandomEventBean

`id`:int, `time`:Number

### RandomHeroBean

`id`:Number, `lockmanagement`:Boolean, `lockpower`:Boolean, `lockstratagem`:Boolean, `management`:int, `player_id`:int, `power`:int, `resetcount`:int, `resettime`:Number, `stratagem`:int

### RandomHeroResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `randomherobean`:RandomHeroBean

### RankAllianceBean

`city`:int, `createrName`:String, `date`:String, `description`:String, `honor`:int, `id`:int, `member`:int, `name`:String, `playerName`:String, `prestige`:int, `rank`:int

### RankAllianceResponse (extends BaseBean)

`beans`:RankAllianceBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `pageSize`:int, `totalPage`:int

### RankCastleBean

`alliance`:String, `grade`:String, `kind`:String, `level`:int, `name`:String, `population`:int, `rank`:int

### RankCastleResponse (extends BaseBean)

`beans`:RankCastleBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `pageSize`:int, `totalPage`:int

### RankHeroBean

`grade`:int, `isHero`:int, `kind`:String, `management`:int, `name`:String, `power`:int, `rank`:int, `stratagem`:int

### RankHeroResponse (extends BaseBean)

`beans`:RankHeroBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `pageSize`:int, `totalPage`:int

### RankPlayerResponse (extends BaseBean)

`beans`:PlayerInfoBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `pageSize`:int, `totalPage`:int

### RankPlayerVotesResponse (extends BaseBean)

`beans`:PlayerInfoBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `pageSize`:int, `preweekterm`:String, `totalPage`:int, `voteendtime`:Number, `votestoal`:Number

### RegisterResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `player`:PlayerBean

Constants: CREATE_RESULT_HAVE_CREATED=-3, CREATE_RESULT_NAME_DUP=-1, CREATE_RESULT_ZONE_FULL=-2

### ReportBean

`armyType`:int, `attack`:Boolean, `back`:Boolean, `content`:String, `eventTime`:String, `id`:int, `isRead`:int, `selected`:Boolean, `startPos`:String, `targetPos`:String, `title`:String, `type`:int

### ReportListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `pageNo`:int, `reports`:ReportBean[], `totalPage`:int

### ReportResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `report`:ReportBean

### ResearchCompleteUpdate (extends BaseBean)

`castleId`:int, `level`:int, `typeId`:int

### ResearchResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `tech`:AvailableResearchListBean

### ResourceBean

`food`:Number, `gold`:Number, `iron`:Number, `stone`:Number, `wood`:Number

### ResourceInfoBean

`amount`:Number, `increaseRate`:Number, `max`:int, `storeRercent`:int, `workPeople`:int

### ResourceProduceDataBean

`armyPercentage`:Number, `basicOutput`:int, `cimeliaPercentage`:int, `commenceDemands`:int, `commenceRate`:int, `fieldPercentage`:int, `heroPercentage`:int, `maxLabour`:int, `naturalPercentage`:int, `productionCapacity`:int, `technologicalPercentage`:int, `totalOutput`:int, `typeid`:int

### ResourceProduceDataResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `resourceProduceDataBean`:ResourceProduceDataBean[]

### ResourceUpdate (extends BaseBean)

`castleId`:int, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `resource`:CastleResourceBean

### SaleItemBean

`items`:String, `saleType`:int

### SaleTypeBean

`items`:String, `typeName`:String

### SearchTradesResponse (extends BaseBean)

`buyers`:MarketTradeBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `sellers`:MarketTradeBean[]

### SecurityCodeRemovedEvent (extends BaseBean)

`isSetSecurityCode`:Boolean

### SelfArmysUpdate (extends BaseBean)

`armys`:ArmyBean[]

### SetShowInfro

`selectshowheroid`:int

### SetShowInfroResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `selectheroids`:SetShowInfro[]

### ShareReportResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `reportId`:int, `reportUrl`:String

### SimpleNpcHeroBean

`introduce`:String, `introduce2`:String, `logourl`:String, `name`:String, `npcid`:int

### StayAllianceReponse (extends BaseBean)

`allianceArmys`:ArmyBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### StoreBean

`magnitude`:int, `resLimt`:int, `storage`:int, `storePercent`:int, `storeTypeId`:int, `unstorage`:int, `warehourseCapacity`:int

### StoreListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `storeBeans`:StoreBean[], `totalCap`:int

### StrategyBuff (extends BaseBean)

### SystemInfoMsg (extends BaseBean)

`alliance`:Boolean, `msg`:String, `noSenderSystemInfo`:Boolean, `sender`:String, `tV`:Boolean, `tVContext`:String

### TVResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `tvBeans`:TVmsgBean[]

### TVmsgBean

`msg`:String, `time`:Number

### TopVotesPlayersResponse (extends BaseBean)

`beans`:PlayerInfoBean[], `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### TradeBean

`amount`:int, `dealedAmount`:int, `dealedTotal`:Number, `id`:int, `price`:Number, `resType`:int, `resourceName`:String, `tradeType`:int, `tradeTypeName`:String

### TradeListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `trades`:TradeBean[]

### TradesUpdate (extends BaseBean)

`castleId`:int, `tradeBean`:TradeBean, `updateType`:int

### TransingTradeBean

`amount`:int, `endTime`:Number, `id`:int, `price`:Number, `resType`:int, `resourceName`:String, `total`:int

### TransingTradeListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `transingTrades`:TransingTradeBean[]

### TransingTradeUpdate (extends BaseBean)

`bean`:TransingTradeBean, `castleId`:int, `updateType`:int

### TroopBean

`archer`:int, `ballista`:int, `batteringRam`:int, `carriage`:int, `catapult`:int, `heavyCavalry`:int, `lightCavalry`:int, `militia`:int, `peasants`:int, `pikemen`:int, `scouter`:int, `swordsmen`:int

### TroopConfigBean

`name`:String, `time`:Number, `troop`:TroopBean

### TroopConfigResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `troopConfigBeans`:TroopConfigBean[]

### TroopParamResponse (extends BaseBean)

`driveSkillParam`:int, `errorMsg`:String, `loadSkillParam`:int, `marchSkillParam`:int, `msg`:String, `ok`:int, `packageId`:Number, `transportStationParam`:int

### TroopProduceListBean

`conditionBean`:ConditionBean, `permition`:Boolean, `typeId`:int

### TroopProduceListResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `troopList`:TroopProduceListBean[]

### TroopStrBean

`archer`:String, `ballista`:String, `batteringRam`:String, `carriage`:String, `catapult`:String, `heavyCavalry`:String, `lightCavalry`:String, `militia`:String, `peasants`:String, `pikemen`:String, `scouter`:String, `swordsmen`:String

### TroopUpdate (extends BaseBean)

`caslteId`:int, `troop`:TroopBean

### UnitAlliance

`aPrestigeCount`:int, `allianceName`:String, `honor`:int, `leaderName`:String, `memberCount`:int, `rank`:int

### UnregisteredCreatePlayerResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `player`:PlayerBean

Constants: CREATE_RESULT_HAVE_CREATED=-3, CREATE_RESULT_NAME_DUP=-1, CREATE_RESULT_ZONE_FULL=-2

### UseItemResultResponse (extends BaseBean)

`errorMsg`:String, `gamblingItemsBeans`:GamblingItemBean[], `itemBeans`:ItemBean[], `msg`:String, `ok`:int, `packageId`:Number

### VisitorCommentBean

`comment`:String, `id`:int, `read`:Boolean, `time`:String, `visitorid`:String

### VisitorHelpEvent (extends BaseBean)

`visitorID`:String, `visitorName`:String

### WantedAllianceResponse (extends BaseBean)

`allianceName`:String, `errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number

### WorldChatMsg (extends BaseBean)

`channel`:String, `fromUser`:String, `languageType`:int, `msg`:String, `ownitemid`:int

### ZoneInfoBean

`castleCount`:int, `id`:int, `name`:String, `playerCount`:int, `rate`:int

### ZoneInfoResponse (extends BaseBean)

`errorMsg`:String, `msg`:String, `ok`:int, `packageId`:Number, `zones`:ZoneInfoBean[]
