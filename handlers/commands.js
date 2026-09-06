const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

// Servers that should receive the latest slash commands immediately.
const PRIORITY_GUILD_IDS = ['1426271681969655913'];

module.exports = async (client, config, colors) => {
    const commandsPath = path.join(__dirname, '../commands');
    const commandFolders = fs.readdirSync(commandsPath);
    const enabledCommandFolders = commandFolders.filter(folder => config.categories[folder]);

    const commands = [];

    for (const folder of enabledCommandFolders) {
        const commandFiles = fs.readdirSync(path.join(commandsPath, folder)).filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
            const command = require(path.join(commandsPath, folder, file));
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
        }
    }

    // Register commands with Discord.
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN || config.token);

    try {
        const registeredCommands = await rest.get(
            Routes.applicationCommands(client.user.id)
        );

        console.log('\n' + '─'.repeat(40));
        console.log(`${colors.yellow}${colors.bright}⚡ SLASH COMMANDS${colors.reset}`);
        console.log('─'.repeat(40));

        if (registeredCommands.length !== commands.length) {
            console.log(`${colors.red}[ LOADER ]${colors.reset} ${colors.green}Loading Slash Commands 🛠️${colors.reset}`);
        }

        // Keep global registration for normal propagation.
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        // Also register directly to priority guilds so new commands appear immediately.
        for (const guildId of PRIORITY_GUILD_IDS) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guildId),
                    { body: commands }
                );
                console.log(`${colors.cyan}[ GUILD ]${colors.reset} ${colors.green}Commands registered to ${guildId} ✓${colors.reset}`);
            } catch (guildError) {
                console.log(`${colors.red}[ GUILD ERROR ]${colors.reset} ${colors.red}Failed to register commands to ${guildId}: ${guildError.message}${colors.reset}`);
            }
        }

        console.log(`${colors.red}[ LOADER ]${colors.reset} ${colors.green}Successfully Loaded Slash Commands ✅${colors.reset}`);
    } catch (error) {
        console.log(`${colors.red}[ ERROR ]${colors.reset} ${colors.red}${error}${colors.reset}`);
    }
};
