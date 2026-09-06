const { AuditLogEvent, EmbedBuilder, PermissionsBitField } = require('discord.js');

const monitors = new Map();
const recentAlerts = new Map();
const joinWindows = new Map();
const seenAuditEntries = new Map();

const RISK_PERMISSIONS = [
    ['Administrator', PermissionsBitField.Flags.Administrator, 35],
    ['Manage Server', PermissionsBitField.Flags.ManageGuild, 18],
    ['Manage Roles', PermissionsBitField.Flags.ManageRoles, 15],
    ['Manage Channels', PermissionsBitField.Flags.ManageChannels, 12],
    ['Ban Members', PermissionsBitField.Flags.BanMembers, 10],
    ['Kick Members', PermissionsBitField.Flags.KickMembers, 8],
    ['Manage Webhooks', PermissionsBitField.Flags.ManageWebhooks, 10],
    ['Manage Messages', PermissionsBitField.Flags.ManageMessages, 6],
    ['Mention Everyone', PermissionsBitField.Flags.MentionEveryone, 6],
    ['Moderate Members', PermissionsBitField.Flags.ModerateMembers, 5],
    ['Manage Events', PermissionsBitField.Flags.ManageEvents, 5],
    ['Manage Threads', PermissionsBitField.Flags.ManageThreads, 4]
];

function botAgeDays(user) {
    return Math.max(0, Math.floor((Date.now() - user.createdTimestamp) / 86400000));
}

function analyseBot(member) {
    let score = 0;
    const reasons = [];
    const age = botAgeDays(member.user);

    if (age < 3) {
        score += 35;
        reasons.push('account <3d');
    } else if (age < 7) {
        score += 25;
        reasons.push('account <7d');
    } else if (age < 30) {
        score += 10;
        reasons.push('account <30d');
    }

    if (member.joinedTimestamp && Date.now() - member.joinedTimestamp < 86400000) {
        score += 15;
        reasons.push('joined <24h');
    }

    for (const [name, flag, weight] of RISK_PERMISSIONS) {
        if (member.permissions.has(flag)) {
            score += weight;
            reasons.push(name);
        }
    }

    const me = member.guild.members.me;
    if (member.roles.highest && me?.roles.highest && member.roles.highest.position >= me.roles.highest.position) {
        score += 15;
        reasons.push('role >= monitor bot');
    }

    score = Math.min(100, score);
    const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';

    return {
        id: member.id,
        tag: member.user.tag,
        score,
        level,
        levelEmoji: level === 'high' ? '🔴' : level === 'medium' ? '🟠' : '🟢',
        age,
        reasons: reasons.slice(0, 8)
    };
}

async function scanGuild(guild) {
    await guild.members.fetch();
    const bots = guild.members.cache
        .filter(member => member.user.bot)
        .map(analyseBot)
        .sort((a, b) => b.score - a.score);

    const result = {
        total: bots.length,
        highRisk: bots.filter(bot => bot.level === 'high').length,
        mediumRisk: bots.filter(bot => bot.level === 'medium').length,
        lowRisk: bots.filter(bot => bot.level === 'low').length,
        bots
    };

    const state = monitors.get(guild.id);
    if (state) state.lastScan = Date.now();
    return result;
}

function canAlert(channel) {
    if (!channel?.isTextBased()) return false;
    const me = channel.guild.members.me;
    return !!me && channel.permissionsFor(me)?.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks
    ]);
}

async function sendAlert(guild, title, description, color = 0xE74C3C, key = title) {
    const state = monitors.get(guild.id);
    if (!state?.enabled || !state.channelId) return;

    const now = Date.now();
    const alertKey = `${guild.id}:${key}`;
    const last = recentAlerts.get(alertKey) || 0;
    if (now - last < 30000) return;
    recentAlerts.set(alertKey, now);

    const channel = guild.channels.cache.get(state.channelId);
    if (!canAlert(channel)) return;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: 'FBMR Bot Security Monitor' })
        .setTimestamp();

    try {
        await channel.send({ embeds: [embed] });
    } catch (_) {}
}

function startMonitoring(guild, channel) {
    if (!guild || !canAlert(channel)) return false;

    monitors.set(guild.id, {
        enabled: true,
        channelId: channel.id,
        startedAt: Date.now(),
        lastScan: Date.now()
    });

    scanGuild(guild).catch(() => {});
    return true;
}

function stopMonitoring(guildId) {
    monitors.delete(guildId);
}

function getStatus(guildId) {
    const state = monitors.get(guildId);
    return {
        enabled: !!state?.enabled,
        channel: state?.channelId || null,
        lastScan: state?.lastScan || null
    };
}

function recordJoin(guildId, isBot) {
    const now = Date.now();
    const state = joinWindows.get(guildId) || { all: [], bots: [] };

    state.all = state.all.filter(timestamp => now - timestamp < 30000);
    state.bots = state.bots.filter(timestamp => now - timestamp < 30000);
    state.all.push(now);
    if (isBot) state.bots.push(now);

    joinWindows.set(guildId, state);
    return state;
}

function setup(client) {
    console.log('\x1b[36m[ SECURITY ]\x1b[0m \x1b[32mBot Security Monitor Loaded 🛡️\x1b[0m');

    client.on('guildMemberAdd', async member => {
        const state = monitors.get(member.guild.id);
        if (!state?.enabled) return;

        const counts = recordJoin(member.guild.id, member.user.bot);

        if (member.user.bot) {
            const result = analyseBot(member);
            await sendAlert(
                member.guild,
                '🤖 New Bot Added',
                `**${member.user.tag}** (\`${member.id}\`) joined the server.\n` +
                `Risk score: **${result.score}/100** ${result.levelEmoji}\n` +
                `Indicators: ${result.reasons.join(', ') || 'none detected'}`,
                result.level === 'high' ? 0xE74C3C : result.level === 'medium' ? 0xF1C40F : 0x2ECC71,
                `bot:${member.id}`
            );
        }

        if (counts.bots.length >= 2) {
            await sendAlert(
                member.guild,
                '🚨 Possible Bot Raid',
                `**${counts.bots.length} bots** joined within the last 30 seconds.`,
                0xE74C3C,
                'bot-join-burst'
            );
        }

        if (counts.all.length >= 10) {
            await sendAlert(
                member.guild,
                '🚨 Possible Join Raid',
                `**${counts.all.length} members** joined within the last 30 seconds.`,
                0xE74C3C,
                'member-join-burst'
            );
        }
    });

    setInterval(async () => {
        for (const guild of client.guilds.cache.values()) {
            const state = monitors.get(guild.id);
            if (!state?.enabled) continue;

            try {
                const logs = await guild.fetchAuditLogs({ limit: 25 });
                const entries = [...logs.entries.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

                for (const entry of entries) {
                    if (!entry.createdTimestamp || entry.createdTimestamp <= state.startedAt) continue;
                    if (seenAuditEntries.has(entry.id)) continue;
                    seenAuditEntries.set(entry.id, Date.now());

                    const actor = entry.executor;
                    const actorMember = actor ? guild.members.cache.get(actor.id) : null;
                    const actorText = actor ? `${actor.tag} (\`${actor.id}\`)` : 'Unknown executor';
                    const target = entry.target?.name || entry.target?.id || 'unknown target';

                    const watchedActions = new Set([
                        AuditLogEvent.BotAdd,
                        AuditLogEvent.MemberBanAdd,
                        AuditLogEvent.MemberKick,
                        AuditLogEvent.ChannelCreate,
                        AuditLogEvent.ChannelDelete,
                        AuditLogEvent.RoleCreate,
                        AuditLogEvent.RoleDelete,
                        AuditLogEvent.RoleUpdate,
                        AuditLogEvent.WebhookCreate,
                        AuditLogEvent.ChannelOverwriteCreate,
                        AuditLogEvent.ChannelOverwriteUpdate,
                        AuditLogEvent.ChannelOverwriteDelete,
                        AuditLogEvent.GuildUpdate
                    ]);

                    if (!watchedActions.has(entry.action)) continue;

                    let title = '⚠️ Security Event';
                    let color = 0xF1C40F;

                    if (entry.action === AuditLogEvent.BotAdd) {
                        title = '🚨 Bot Added';
                        color = 0xE74C3C;
                    } else if ([
                        AuditLogEvent.MemberBanAdd,
                        AuditLogEvent.MemberKick,
                        AuditLogEvent.ChannelDelete,
                        AuditLogEvent.RoleDelete
                    ].includes(entry.action)) {
                        title = '🚨 Destructive Security Event';
                        color = 0xE74C3C;
                    } else if (actorMember?.user.bot) {
                        title = '🚨 Bot Security Event';
                        color = 0xE74C3C;
                    }

                    await sendAlert(
                        guild,
                        title,
                        `**Action:** \`${entry.action}\`\n` +
                        `**Actor:** ${actorText}${actorMember?.user.bot ? ' 🤖' : ''}\n` +
                        `**Target:** \`${target}\``,
                        color,
                        `audit:${entry.id}`
                    );
                }

                state.lastScan = Date.now();
            } catch (_) {
                // Missing View Audit Log or temporary Discord API errors must not crash the bot.
            }
        }

        // Keep the dedupe map small.
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const [id, timestamp] of seenAuditEntries) {
            if (timestamp < cutoff) seenAuditEntries.delete(id);
        }
    }, 15000);
}

module.exports = {
    setup,
    scanGuild,
    startMonitoring,
    stopMonitoring,
    getStatus
};
