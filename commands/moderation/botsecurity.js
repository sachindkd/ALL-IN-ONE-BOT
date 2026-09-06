const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require('discord.js');

const botSecurity = require('../../handlers/botSecurity');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botsecurity')
        .setDescription('Scan server bots and monitor for bot/raid security threats.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName('scan')
            .setDescription('Scan every bot currently in the server.'))
        .addSubcommand(sub => sub
            .setName('monitor')
            .setDescription('Start live bot and raid security monitoring in this channel.'))
        .addSubcommand(sub => sub
            .setName('stop')
            .setDescription('Stop live bot and raid security monitoring.'))
        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Show bot security monitoring status.')),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'scan') {
            await interaction.deferReply({ ephemeral: true });
            const result = await botSecurity.scanGuild(interaction.guild);

            const embed = new EmbedBuilder()
                .setTitle('🛡️ Bot Security Scan')
                .setColor(result.highRisk ? 0xE74C3C : result.mediumRisk ? 0xF1C40F : 0x2ECC71)
                .setDescription(
                    `**${interaction.guild.name}**\n` +
                    `Found **${result.total}** bot${result.total === 1 ? '' : 's'}.\n\n` +
                    `🔴 High risk: **${result.highRisk}**\n` +
                    `🟠 Medium risk: **${result.mediumRisk}**\n` +
                    `🟢 Low risk: **${result.lowRisk}**`
                )
                .setTimestamp();

            if (!result.bots.length) {
                embed.addFields({ name: 'Bot Inventory', value: 'No bots are currently in this server.' });
            } else {
                // Keep every bot visible while respecting Discord's embed field limits.
                const groups = [];
                for (let i = 0; i < result.bots.length; i += 5) groups.push(result.bots.slice(i, i + 5));
                groups.slice(0, 25).forEach((group, index) => {
                    embed.addFields({
                        name: `Bots ${index * 5 + 1}–${index * 5 + group.length}`,
                        value: group.map(bot =>
                            `${bot.levelEmoji} **${bot.tag}**\n` +
                            `ID: \`${bot.id}\` • Risk: **${bot.score}/100**\n` +
                            `${bot.reasons.length ? bot.reasons.join(', ') : 'No obvious risk indicators'}`
                        ).join('\n\n')
                    });
                });
            }

            embed.addFields({
                name: 'Raid / Security Detection',
                value: 'Bot additions • bot join bursts • member join bursts • mass bans/kicks • channel/role changes • webhook creation • permission changes • suspicious audit-log activity'
            });

            return interaction.editReply({ embeds: [embed] });
        }

        if (subcommand === 'monitor') {
            const started = botSecurity.startMonitoring(interaction.guild, interaction.channel);
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Bot Security Monitor')
                .setColor(started ? 0x2ECC71 : 0xE74C3C)
                .setDescription(started
                    ? `Live security monitoring is now **ON**.\nAlerts will be posted in ${interaction.channel}.`
                    : 'Could not start monitoring. I need View Channel, Send Messages, Embed Links and View Audit Log access.')
                .addFields({
                    name: 'Watching',
                    value: 'Bot additions • bot permission risk • join bursts • mass moderation • channel/role changes • webhook activity • suspicious audit-log activity'
                })
                .setTimestamp();

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (subcommand === 'stop') {
            botSecurity.stopMonitoring(interaction.guild.id);
            return interaction.reply({
                content: '🛡️ Bot security monitoring has been stopped for this server.',
                ephemeral: true
            });
        }

        const status = botSecurity.getStatus(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Bot Security Status')
            .setColor(status.enabled ? 0x2ECC71 : 0x95A5A6)
            .addFields(
                { name: 'Monitoring', value: status.enabled ? '🟢 ON' : '⚪ OFF', inline: true },
                { name: 'Alert Channel', value: status.channel ? `<#${status.channel}>` : 'Not set', inline: true },
                { name: 'Last Scan', value: status.lastScan ? `<t:${Math.floor(status.lastScan / 1000)}:R>` : 'Never', inline: true }
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
