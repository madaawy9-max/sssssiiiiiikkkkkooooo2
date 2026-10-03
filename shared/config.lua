Config = {}
Config.CoreName = 'qb-core'
Config.MainColor = '#696969'
Config.MaxTeamSize = 5

Config.Rank = {
    Enable = true,
    CommandName = "rank",
    KeyToOpenRank = "G",
    ShowTeamNameTags = false,
    NameTagDistance = 100.0,
    LeaderboardMaxPlayers = 10
}

Config.ServerIDs = true
Config.LeaveMatchCommand = true
Config.LeaveMatchCommandName = "ff"

Config.Rounds = {
    ["1v1"] = 7,
    ["2v2"] = 7,
    ["3v3"] = 7,
    ["4v4"] = 7,
    ["5v5"] = 7
}


Config.RankWinPoints = 10
Config.RankLossPoints = 5
Config.RoundTime = 900
Config.EnableKillCommand = true
Config.EnableStopSpectateCommand = true
Config.SetPointsCommandName = "setrankpoints"
Config.ServerName = "DEATH FIGHT"
Config.RankCommandPermissions = {
    "admin",
    "founders",
    "head-admin",
    "operator",
    "supervisor",
    "director",
    "general-manager",
    "owner"
}

Config.Spawn = {
    vector3(955.97, -3083.96, -55.52),
    vector3(955.97, -3083.96, -55.52),
    vector3(951.88, -3096.05, -55.49),
    vector3(960.35, -3095.54, -55.49)
}

Config.GameModes = {
    {
        name = "Gang War",
        image = "img/gangwar.png",
        type = "gangwar"
    },
    {
        name = "Deathmatch",
        image = "img/deathmatch.png",
        type = "deathmatch"
    }
}

Config.GangWar = {
    ["1v1"] = false,
    ["2v2"] = false,
    ["3v3"] = false,
    ["4v4"] = false,
    ["5v5"] = false
}

Config.Zone = {
    Enable = true,
    DamagePerSecond = 5,
    ShrinkTime = 6000,
    MinRadius = 1.0,
    Stages = 5
}

Config.Vehicles = {
    [1] = "sultan",
    [2] = "adder",
    [3] = "zentorno",
    [4] = "banshee",
    [5] = "turismor"
}

Config.Ranks = {
    { name = "Bronze I",     points = 0,    image = "img/Bronze_I.png" },
    { name = "Bronze II",    points = 50,   image = "img/Bronze_II.png" },
    { name = "Bronze III",   points = 100,  image = "img/Bronze_III.png" },
    { name = "Silver I",     points = 150,  image = "img/Sliver_I.png" },
    { name = "Silver II",    points = 200,  image = "img/Sliver_II.png" },
    { name = "Silver III",   points = 250,  image = "img/Sliver_III.png" },
    { name = "Gold I",       points = 350,  image = "img/Gold_I.png" },
    { name = "Gold II",      points = 450,  image = "img/Gold_II.png" },
    { name = "Gold III",     points = 500,  image = "img/Gold_III.png" },
    { name = "Platinum I",   points = 650,  image = "img/Platinum_I.png" },
    { name = "Platinum II",  points = 850,  image = "img/Platinum_II.png" },
    { name = "Platinum III", points = 1050, image = "img/Platinum_III.png" },
    { name = "Diamond I",    points = 1350, image = "img/Diamond_I.png" },
    { name = "Diamond II",   points = 1550, image = "img/Diamond_II.png" },
    { name = "Diamond III",  points = 1750, image = "img/Diamond_III.png" },
    { name = "Crimson I",    points = 1950, image = "img/Crimson_I.png" },
    { name = "Crimson II",   points = 2500, image = "img/Crimson_II.png" },
    { name = "Crimson III",  points = 3000, image = "img/Crimson_III.png" },
    { name = "Iridescent",   points = 3600, image = "img/Iridescent.png" },
    { name = "Top 100",       points = 4300, image = "img/Top.png" },
}

Config.Maps = {

    ["1v1"] = {
        {
            name = "RUNGUN",
            image = "img/rungun.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3285.79, -2991.44, 1288.02, 356.04),
            teamB = vector4(-3287.77, -2948.59, 1288.02, 173.39),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "MINECRAFT",
            image = "https://i.postimg.cc/FsHnJ9Wg/Minecraft.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-1964.32, -1502.8, 321.06, 90.0),
            teamB = vector4(-1937.15, -1504.44, 321.06, 270.0),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Zam",
            image = "img/Zam.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.43, 173.14, 1031.45, 4.05),
            teamB = vector4(-3948.51, 202.05, 1031.45, 179.05),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Office",
            image = "img/Office.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3933.12, 2888.51, 1031.44, 91.06),
            teamB = vector4(-3964.53, 2882.39, 1031.44, 270.77),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Run_Gun_3D",
            image = "img/Run_Gun_3D.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3899.71, 1781.28, 1031.0, 90.98),
            teamB = vector4(-3942.15, 1779.24, 1031.0, 271.59),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Run Gun Small",
            image = "img/Run_Gun_Small.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3933.07, 707.89, 1029.94, 91.89),
            teamB = vector4(-3964.06, 707.61, 1029.94, 273.8),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Toilet",
            image = "img/Toilet.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3928.59, -1758.76, 1031.58, 93.89),
            teamB = vector4(-3960.78, -1753.78, 1031.57, 272.79),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Nuke",
            image = "img/Nuke.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.73, 3209.22, 1031.3, 179.11),
            teamB = vector4(-3948.78, 3185.61, 1031.31, 0.28),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Dust",
            image = "img/Dust.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3180.22, -332.18, 556.53, 180.0),
            teamB = vector4(-3181.12, -365.4, 556.53, 0.0),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Limbo",
            image = "img/Limbo.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3961.99, 4033.78, 1031.44, 270.59),
            teamB = vector4(-3941.57, 4034.15, 1031.43, 94.81),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "SPY",
            image = "img/SPY.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3557.7, 1361.16, 310.36, 180.0),
            teamB = vector4(-3530.37, 1361.38, 310.36, 0.0),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
    },

    ["2v2"] = {
        {
            name = "RUNGUN",
            image = "img/rungun.png",
            gangwar = true,
            deathmatch = true,
          teamA = vector4(-3285.79, -2991.44, 1288.02, 356.04),
            teamB = vector4(-3287.77, -2948.59, 1288.02, 173.39),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Toilet",
            image = "img/Toilet.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3928.59, -1758.76, 1031.58, 93.89),
            teamB = vector4(-3960.78, -1753.78, 1031.57, 272.79),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "MINECRAFT",
            image = "https://i.postimg.cc/FsHnJ9Wg/Minecraft.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-1964.32, -1502.8, 321.06, 90.0),
            teamB = vector4(-1937.15, -1504.44, 321.06, 270.0),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Old Gun Wood",
            image = "img/Old_Gun_Wood.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3942.69, 1239.37, 1025.62, 0.03),
            teamB = vector4(-3952.92, 1268.57, 1025.62, 181.21),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Run_Gun_3D",
            image = "img/Run_Gun_3D.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3899.71, 1781.28, 1031.0, 90.98),
            teamB = vector4(-3942.15, 1779.24, 1031.0, 271.59),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Limbo",
            image = "img/Limbo.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3961.99, 4033.78, 1031.44, 270.59),
            teamB = vector4(-3941.57, 4034.15, 1031.43, 94.81),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Gulag",
            image = "img/Gulag.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3927.14, 4417.49, 1031.44, 90.11),
            teamB = vector4(-3969.8, 4416.85, 1031.44, 270.74),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Dingo",
            image = "img/Dingo.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3946.45, 4792.46, 1031.43, 176.15),
            teamB = vector4(-3922.24, 4768.36, 1031.44, 88.44),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Zam",
            image = "img/Zam.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.43, 173.14, 1031.45, 4.05),
            teamB = vector4(-3948.51, 202.05, 1031.45, 179.05),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Office",
            image = "img/Office.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3933.12, 2888.51, 1031.44, 91.06),
            teamB = vector4(-3964.53, 2882.39, 1031.44, 270.77),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "BoxFight Old",
            image = "img/box_fight.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(442.84, 7524.07, 457.85, 353.35),
            teamB = vector4(445.91, 7561.35, 457.85, 173.67),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "RunGun Wood",
            image = "img/Run_Gun_Wood.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3968.41, 2445.89, 1029.94, 275.64),
            teamB = vector4(-3928.08, 2446.15, 1029.94, 90.76),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Cyming",
            image = "img/Cyming.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3945.77, 5577.31, 1031.44, 184.75),
            teamB = vector4(-3943.51, 5547.35, 1031.43, 0.25),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "SPY",
            image = "img/SPY.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3557.7, 1361.16, 310.36, 180.0),
            teamB = vector4(-3530.37, 1361.38, 310.36, 0.0),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Masty",
            image = "img/Masty.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.37, 3648.55, 1031.44, 179.72),
            teamB = vector4(-3948.34, 3617.74, 1031.44, 359.46),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
    },

    ["3v3"] = {
        {
            name = "Warehouse_Small",
            image = "img/Warehouse_Small.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3963.7, -853.4, 1031.44, 268.73),
            teamB = vector4(-3965.36, -837.52, 1031.51, 267.79),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "RUNGUN",
            image = "img/rungun.png",
            gangwar = true,
            deathmatch = true,
             teamA = vector4(-3285.79, -2991.44, 1288.02, 356.04),
            teamB = vector4(-3287.77, -2948.59, 1288.02, 173.39),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "CONTAINERS",
            image = "img/CONTAINERS.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-1018.62, -3532.73, 1577.15, 62.67),
            teamB = vector4(-1087.12, -3493.37, 1577.15, 237.05),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Run_Gun_3D",
            image = "img/Run_Gun_3D.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3899.71, 1781.28, 1031.0, 90.98),
            teamB = vector4(-3942.15, 1779.24, 1031.0, 271.59),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Dingo",
            image = "img/Dingo.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3946.45, 4792.46, 1031.43, 176.15),
            teamB = vector4(-3922.24, 4768.36, 1031.44, 88.44),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Dienet",
            image = "img/Dienet.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.42, 5155.47, 1030.91, 1.87),
            teamB = vector4(-3948.41, 5201.56, 1030.91, 183.9),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Old Gun Wood",
            image = "img/Old_Gun_Wood.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3942.69, 1239.37, 1025.62, 0.03),
            teamB = vector4(-3952.92, 1268.57, 1025.62, 181.21),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Zing",
            image = "img/Zing.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3969.8, -263.49, 1027.64, 272.91),
            teamB = vector4(-3927.35, -263.51, 1027.64, 91.56),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Masty",
            image = "img/Masty.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.37, 3648.55, 1031.44, 179.72),
            teamB = vector4(-3948.34, 3617.74, 1031.44, 359.46),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "RunGun Wood",
            image = "img/Run_Gun_Wood.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3968.41, 2445.89, 1029.94, 275.64),
            teamB = vector4(-3928.08, 2446.15, 1029.94, 90.76),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "MINECRAFT LARGE",
            image = "img/MinecraftLARGE.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3764.62, -3073.7, 175.12, 271.07),
            teamB = vector4(-3712.55, -3095.57, 175.12, 88.43),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Stone",
            image = "img/Stone.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3953.26, -1319.68, 1031.17, 0.96),
            teamB = vector4(-3959.05, -1281.14, 1031.17, 182.81),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "CiCi",
            image = "img/CiCi.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.37, 5928.53, 1031.24, 358.7),
            teamB = vector4(-3948.36, 5963.07, 1031.24, 178.36),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "BoxFight",
            image = "img/box_fight.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(442.84, 7524.07, 457.85, 353.35),
            teamB = vector4(445.91, 7561.35, 457.85, 173.67),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "BoxFight New",
            image = "img/box_fight_new.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.33, 6453.9, 1028.98, 183.43),
            teamB = vector4(-3948.56, 6414.23, 1028.98, 358.9),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
    },

    ["4v4"] = {
        {
            name = "RUNGUN",
            image = "img/rungun.png",
            gangwar = true,
            deathmatch = true,
           teamA = vector4(-3285.79, -2991.44, 1288.02, 356.04),
            teamB = vector4(-3287.77, -2948.59, 1288.02, 173.39),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "CiCi",
            image = "img/CiCi.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.37, 5928.53, 1031.24, 358.7),
            teamB = vector4(-3948.36, 5963.07, 1031.24, 178.36),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "CONTAINERS",
            image = "img/CONTAINERS.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-1018.62, -3532.73, 1577.15, 62.67),
            teamB = vector4(-1087.12, -3493.37, 1577.15, 237.05),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "MINECRAFT LARGE",
            image = "img/MinecraftLARGE.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3764.62, -3073.7, 175.12, 271.07),
            teamB = vector4(-3712.55, -3095.57, 175.12, 88.43),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Zing",
            image = "img/Zing.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3969.8, -263.49, 1027.64, 272.91),
            teamB = vector4(-3927.35, -263.51, 1027.64, 91.56),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "BoxFight New",
            image = "img/box_fight_new.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.33, 6453.9, 1028.98, 183.43),
            teamB = vector4(-3948.56, 6414.23, 1028.98, 358.9),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Blint",
            image = "img/Blint.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3950.37, 6936.64, 1031.44, 358.54),
            teamB = vector4(-3950.37, 6936.64, 1031.44, 358.54),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Stone",
            image = "img/Stone.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3953.26, -1319.68, 1031.17, 0.96),
            teamB = vector4(-3959.05, -1281.14, 1031.17, 182.81),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "Masty",
            image = "img/Masty.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3948.37, 3648.55, 1031.44, 179.72),
            teamB = vector4(-3948.34, 3617.74, 1031.44, 359.46),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "BOXFIGHT LARGE",
            image = "img/boxfight.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(600.41, 7590.43, 458.46, 178.21),
            teamB = vector4(600.71, 7549.57, 458.46, 1.91),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "RunGun New",
            image = "img/Run_Gun_Wood.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3968.41, 2445.89, 1029.94, 275.64),
            teamB = vector4(-3928.08, 2446.15, 1029.94, 90.76),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "FARM",
            image = "img/farm.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-331.69, -1959.32, 1186.51, 228.75),
            teamB = vector4(-292.96, -1992.99, 1186.5, 54.6),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
    },

    ["5v5"] = {
        {
            name = "CONTAINERS",
            image = "img/CONTAINERS.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-1018.62, -3532.73, 1577.15, 62.67),
            teamB = vector4(-1087.12, -3493.37, 1577.15, 237.05),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "BOXFIGHT LARGE",
            image = "img/boxfight.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(600.41, 7590.43, 458.46, 178.21),
            teamB = vector4(600.71, 7549.57, 458.46, 1.91),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "SHOUTHOUSE",
            image = "img/SHOUTHOUSE.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3890.64, -1774.04, 1165.51, 180.86),
            teamB = vector4(-3891.01, -1853.04, 1165.51, 3.25),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "MINECRAFT LARGE",
            image = "img/MinecraftLARGE.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-3764.62, -3073.7, 175.12, 271.07),
            teamB = vector4(-3712.55, -3095.57, 175.12, 88.43),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
        {
            name = "FARM",
            image = "img/farm.png",
            gangwar = true,
            deathmatch = true,
            teamA = vector4(-331.69, -1959.32, 1186.51, 228.75),
            teamB = vector4(-292.96, -1992.99, 1186.5, 54.6),
            zoneCenter = vector3(3951.5, -1226.94, 2400.86),
            initialRadius = 200.0
        },
    },
}

Config.CustomMatch = {
    -- Command = 'custommatch',
    -- CommandPermission = 'admin',
    LeaveMatchCommand = true,
    LeaveMatchCommandName = "cc",
    RoundTime = 300,
    MaxPlayersPerTeam = 5,
    RoundsOptions = { 5, 7, 10, 12 },
    Maps = {
        {
            name = 'RUNGUN',
            image = 'img/rungun.png',
            teamASpawn = vector4(-3285.79, -2991.44, 1288.02, 356.04),
            teamBSpawn = vector4(-3287.77, -2948.59, 1288.02, 173.39),
        },
        {
            name = 'MINECRAFT',
            image = 'https://i.postimg.cc/FsHnJ9Wg/Minecraft.png',
            teamASpawn = vector4(-1964.32, -1502.8, 321.06, 90.0),
            teamBSpawn = vector4(-1937.15, -1504.44, 321.06, 270.0)
        },
        {
            name = 'Old Gun Wood',
            image = 'img/Old_Gun_Wood.png',
            teamASpawn = vector4(-3942.69, 1239.37, 1025.62, 0.03),
            teamBSpawn = vector4(-3952.92, 1268.57, 1025.62, 181.21)
        },
        {
            name = 'BoxFight Old',
            image = 'img/box_fight.png',
            teamASpawn = vector4(442.84, 7524.07, 457.85, 353.35),
            teamBSpawn = vector4(445.91, 7561.35, 457.85, 173.67)
        },
        {
            name = 'RunGun Wood',
            image = 'img/Run_Gun_Wood.png',
            teamASpawn = vector4(-3968.41, 2445.89, 1029.94, 275.64),
            teamBSpawn = vector4(-3928.08, 2446.15, 1029.94, 90.76)
        },
        {
            name = 'CONTAINERS',
            image = 'img/CONTAINERS.png',
            teamASpawn = vector4(-1018.62, -3532.73, 1577.15, 62.67),
            teamBSpawn = vector4(-1087.12, -3493.37, 1577.15, 237.05)
        },
        {
            name = 'Masty',
            image = 'img/Masty.png',
            teamASpawn = vector4(-3948.37, 3648.55, 1031.44, 179.72),
            teamBSpawn = vector4(-3948.34, 3617.74, 1031.44, 359.46)
        },
        {
            name = 'MINECRAFT LARGE',
            image = 'img/MinecraftLARGE.png',
            teamASpawn = vector4(-3764.62, -3073.7, 175.12, 271.07),
            teamBSpawn = vector4(-3712.55, -3095.57, 175.12, 88.43)
        },
        {
            name = 'Blint',
            image = 'img/Blint.png',
            teamASpawn = vector4(-3950.37, 6936.64, 1031.44, 358.54),
            teamBSpawn = vector4(-3950.37, 6936.64, 1031.44, 358.54)
        },
        {
            name = 'Stone',
            image = 'img/Stone.png',
            teamASpawn = vector4(-3953.26, -1319.68, 1031.17, 0.96),
            teamBSpawn = vector4(-3959.05, -1281.14, 1031.17, 182.81)
        },
        {
            name = 'CiCi',
            image = 'img/CiCi.png',
            teamASpawn = vector4(-3948.37, 5928.53, 1031.24, 358.7),
            teamBSpawn = vector4(-3948.36, 5963.07, 1031.24, 178.36)
        },
        {
            name = 'BoxFight New',
            image = 'img/box_fight_new.png',
            teamASpawn = vector4(-3948.33, 6453.9, 1028.98, 183.43),
            teamBSpawn = vector4(-3948.56, 6414.23, 1028.98, 358.9)
        },
        {
            name = 'BOXFIGHT LARGE',
            image = 'img/boxfight.png',
            teamASpawn = vector4(600.41, 7590.43, 458.46, 178.21),
            teamBSpawn = vector4(600.71, 7549.57, 458.46, 1.91)
        },
        {
            name = 'FARM',
            image = 'img/farm.png',
            teamASpawn = vector4(-331.69, -1959.32, 1186.51, 228.75),
            teamBSpawn = vector4(-292.96, -1992.99, 1186.5, 54.6)
        },
        {
            name = 'Warehouse_Small',
            image = 'img/Warehouse_Small.png',
            teamASpawn = vector4(-3964.9, -856.67, 1031.43, 269.06),
            teamBSpawn = vector4(-3967.44, -837.51, 1031.51, 267.43)
        },
        {
            name = 'Toilet',
            image = 'img/Toilet.png',
            teamASpawn = vector4(-3958.49, -1754.3, 1031.57, 271.16),
            teamBSpawn = vector4(-3927.87, -1758.32, 1031.57, 88.23)
        },
        {
            name = 'Run_Gun_3D',
            image = 'img/Run_Gun_3D.png',
            teamASpawn = vector4(-3942.15, 1779.24, 1031.0, 271.59),
            teamBSpawn = vector4(-3898.68, 1780.87, 1031.0, 95.36)
        },
        {
            name = 'Run_Gun_Small',
            image = 'img/Run_Gun_Small.png',
            teamASpawn = vector4(-3930.23, 708.04, 1029.94, 95.39),
            teamBSpawn = vector4(-3965.41, 707.37, 1029.94, 271.62)
        },
        {
            name = 'Limbo',
            image = 'img/Limbo.png',
            teamASpawn = vector4(-3961.99, 4033.78, 1031.44, 270.59),
            teamBSpawn = vector4(-3941.57, 4034.15, 1031.43, 94.81)
        },
        {
            name = 'Zing',
            image = 'img/Zing.png',
            teamASpawn = vector4(-3927.68, -263.36, 1027.64, 92.82),
            teamBSpawn = vector4(-3969.8, -263.49, 1027.64, 272.91)
        },
        {
            name = 'Gulag',
            image = 'img/Gulag.png',
            teamASpawn = vector4(-3927.14, 4417.49, 1031.44, 90.11),
            teamBSpawn = vector4(-3969.8, 4416.85, 1031.44, 270.74)
        },
        {
            name = 'Dienet',
            image = 'img/Dienet.png',
            teamASpawn = vector4(-3948.42, 5155.47, 1030.91, 1.87),
            teamBSpawn = vector4(-3948.41, 5201.56, 1030.91, 183.9)
        },
        {
            name = 'Cyming',
            image = 'img/Cyming.png',
            teamASpawn = vector4(-3945.77, 5577.31, 1031.44, 184.75),
            teamBSpawn = vector4(-3943.51, 5547.35, 1031.43, 0.25)
        },
        {
            name = 'Dingo',
            image = 'img/Dingo.png',
            teamASpawn = vector4(-3946.45, 4792.46, 1031.43, 176.15),
            teamBSpawn = vector4(-3922.24, 4768.36, 1031.44, 88.44)
        },
        {
            name = 'SHOUTHOUSE',
            image = 'img/SHOUTHOUSE.png',
            teamASpawn = vector4(-3890.64, -1774.04, 1165.51, 180.86),
            teamBSpawn = vector4(-3891.01, -1853.04, 1165.51, 3.25)
        }
    }
}
