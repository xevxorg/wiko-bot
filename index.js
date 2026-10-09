const {
  Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder,
  ActionRowBuilder, ButtonStyle
} = require('discord.js');
const fs = require('fs');
const config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildBans
  ]
});

// ==============================================
// DATABASE
// ==============================================
const DB = {
  data: {
    prefixes: {}, logChannels: {}, whitelist: {}, premium: {},
    premiumCodes: {}, antinuke: {}, jtcConfig: {}, tickets: {}, ticketSettings: {}
  },
  load() { try { Object.assign(this.data, JSON.parse(fs.readFileSync('./db.json','utf8'))); } catch {} },
  save() { fs.writeFileSync('./db.json', JSON.stringify(this.data, null, 2)); },
  
  // Prefix
  getPrefix(gid) { return this.data.prefixes[gid] || config.defaultPrefix; },
  setPrefix(gid, p) { this.data.prefixes[gid] = p; this.save(); },
  
  // Log Channel
  setLog(gid, cid) { this.data.logChannels[gid] = cid; this.save(); },
  getLog(gid) { return this.data.logChannels[gid] || config.logChannelId || null; },
  
  // Whitelist
  isWhitelisted(gid, uid) { return (this.data.whitelist[gid]||[]).includes(uid) || uid === config.ownerId; },
  whitelistAdd(gid, uid) { if(!this.data.whitelist[gid]) this.data.whitelist[gid]=[]; this.data.whitelist[gid].push(uid); this.save(); },
  whitelistRemove(gid, uid) { this.data.whitelist[gid] = (this.data.whitelist[gid]||[]).filter(id=>id!==uid); this.save(); },
  
  // Premium System
  isPremium(gid) { return !!this.data.premium[gid]; },
  premiumAdd(gid) { this.data.premium[gid] = true; this.save(); },
  
  // Premium Code Generator — OWNER ONLY
  createPremiumCode(createdBy) {
    const code = 'WIKO-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    this.data.premiumCodes[code] = {
      createdBy,
      used: false,
      createdAt: Date.now()
    };
    this.save();
    return code;
  },
  
  // Redeem Code
  redeemPremiumCode(code, gid) {
    const c = this.data.premiumCodes[code];
    if(!c || c.used) return false;
    c.used = true;
    c.usedAt = Date.now();
    this.premiumAdd(gid);
    this.save();
    return true;
  },
  
  // Antinuke
  getAntinuke(gid) { return this.data.antinuke[gid] || { enabled: true, strict: false }; },
  setAntinuke(gid, obj) { this.data.antinuke[gid] = { ...this.getAntinuke(gid), ...obj }; this.save(); },
  
  // JTC & Tickets (simplified)
  getJTC(gid) { return this.data.jtcConfig[gid] || { enabled: false }; },
  setJTC(gid, obj) { this.data.jtcConfig[gid] = { ...this.getJTC(gid), ...obj }; this.save(); },
  getTicketSettings(gid) { return this.data.ticketSettings[gid] || { maxPerUser: 3 }; },
  setTicketSettings(gid, obj) { this.data.ticketSettings[gid] = { ...this.getTicketSettings(gid), ...obj }; this.save(); }
};
DB.load();

// ==============================================
// LOGGING
// ==============================================
async function sendLog(guild, embed) {
  const cid = DB.getLog(guild.id);
  if(!cid) return;
  const ch = guild.channels.cache.get(cid);
  if(ch?.send) ch.send({ embeds: [embed] }).catch(()=>{});
}

// ==============================================
// ANTINUKE PROTECTION
// ==============================================
client.on('guildMemberRemove', async member => {
  const cfg = DB.getAntinuke(member.guild.id);
  if(!cfg.enabled || !cfg.strict) return;
  const entry = await member.guild.fetchAuditLogs({limit:3}).then(l=>l.entries.find(e=>
    ['MEMBER_BAN_ADD','MEMBER_KICK','CHANNEL_DELETE','ROLE_DELETE','ROLE_CREATE'].includes(e.action)
  )).catch(()=>null);
  if(!entry?.executor || entry.executor.id === client.user.id) return;
  if(DB.isWhitelisted(member.guild.id, entry.executor.id)) return;
  try { await member.guild.members.ban(entry.executor.id, { reason: '⚠️ Antinuke Strict — Unwhitelisted action' }); } catch {}
  sendLog(member.guild, new EmbedBuilder().setColor('Red').setTitle('🚨 ANTINUKE BAN').setDescription(`Banned: <@${entry.executor.id}>`));
});
client.on('roleCreate', async role => {
  const cfg = DB.getAntinuke(role.guild.id); if(!cfg.enabled||!cfg.strict) return;
  const entry = await role.guild.fetchAuditLogs({limit:1}).then(l=>l.entries.first()).catch(()=>null);
  if(!entry?.executor || DB.isWhitelisted(role.guild.id, entry.executor.id)) return;
  try { await role.guild.members.ban(entry.executor.id, { reason: '⚠️ Antinuke — Role creation' }); } catch {}
});
client.on('channelDelete', async ch => {
  const cfg = DB.getAntinuke(ch.guild.id); if(!cfg.enabled||!cfg.strict) return;
  const entry = await ch.guild.fetchAuditLogs({limit:1}).then(l=>l.entries.first()).catch(()=>null);
  if(!entry?.executor || DB.isWhitelisted(ch.guild.id, entry.executor.id)) return;
  try { await ch.guild.members.ban(entry.executor.id, { reason: '⚠️ Antinuke — Channel deletion' }); } catch {}
});

// ==============================================
// COMMAND HANDLER
// ==============================================
client.on('messageCreate', async msg => {
  if(!msg.guild || msg.author.bot) return;
  const prefix = DB.getPrefix(msg.guild.id);
  if(!msg.content.startsWith(prefix)) return;
  const [cmd, ...args] = msg.content.slice(prefix.length).trim().split(/\s+/);

  // ──── HELP — Shows Prefix + All Commands ────
  if(cmd === 'help' || cmd === 'commands') {
    const isPrem = DB.isPremium(msg.guild.id);
    const embed = new EmbedBuilder()
      .setColor('#23a559')
      .setTitle('📋 Bot Commands')
      .setDescription(`**Current Prefix:** \`${prefix}\`\nPremium Status: ${isPrem ? '✅ ACTIVE' : '🔒 LOCKED'}`)
      .addFields(
        { name: '🔐 Premium Activation', value: `\`${prefix}activate <code>\` — Activate Premium\n*Need code from Bot Owner*` },
        { name: '🛡️ Antinuke', value: `\`${prefix}antinuke enable/disable\`\n\`${prefix}antinuke strict on/off\` ${isPrem?'✅ Premium':'🔒 Premium'}` },
        { name: '✅ Whitelist', value: `\`${prefix}whitelist add @user\`\n\`${prefix}whitelist remove @user\`\n\`${prefix}whitelist list\`\n\`${prefix}multiwl <id1> <id2>\`\n\`${prefix}multiunwl <id1> <id2>\`` },
        { name: '⚖️ Moderation', value: `\`${prefix}purge <amount>\`\n\`${prefix}ban @user [reason]\`\n\`${prefix}unban <id>\`\n\`${prefix}kick @user\`\n\`${prefix}multiban <id1> <id2>\`\n\`${prefix}multiunban <id1> <id2>\`` },
        { name: '🎭 Roles', value: `\`${prefix}makerole <name>\` ${isPrem?'✅ Premium':'🔒 Premium'}\n\`${prefix}deleterole @role\` ${isPrem?'✅ Premium':'🔒 Premium'}` },
        { name: '🖼️ Avatar', value: `\`${prefix}setbotpfp <URL>\` ${isPrem?'✅ Premium — Server Only':'🔒 Premium'}` },
        { name: '⚙️ Settings', value: `\`${prefix}setprefix <newPrefix>\`\n\`${prefix}setlogchannel <#channel>\`` },
        { name: 'ℹ️ Info', value: `\`${prefix}ping\`\n\`${prefix}serverinfo\`` }
      )
      .setFooter({ text: 'Credits to WIKO ✦ Built by Wiko' });
    return msg.reply({ embeds: [embed] });
  }

  // ──── 🔑 OWNER ONLY — GENERATE PREMIUM CODE ────
  if(cmd === 'gencode' || cmd === 'genpremium') {
    if(msg.author.id !== config.ownerId)
      return msg.reply('❌ **Only Bot Owner can generate codes**');
    
    const code = DB.createPremiumCode(msg.author.id);
    return msg.reply(`
🔑 **PREMIUM ACTIVATION CODE GENERATED**
══════════════════════════════════════════
\`${code}\`

📤 Give this code to the server owner
They activate with:
\`${prefix}activate ${code}\`
    `);
  }

  // ──── 🔓 USER — ACTIVATE PREMIUM WITH CODE ────
  if(cmd === 'activate' || cmd === 'redeem') {
    const code = args[0]?.toUpperCase();
    if(!code) return msg.reply(`
🔐 **Activate Premium System**
══════════════════════════════════════════
Need a code from **Bot Owner**
Usage: \`${prefix}activate <code>\`
    `);
    
    if(DB.redeemPremiumCode(code, msg.guild.id)) {
      return msg.reply(`
✅ **PREMIUM ACTIVATED SUCCESSFULLY!**
══════════════════════════════════════════
🔓 All Premium Commands Unlocked:
• setbotpfp — Change bot avatar (Server Only — NOT Global)
• antinuke strict — Auto-ban attackers
• makerole — Create new roles
• deleterole — Delete roles

Credits to WIKO ✦
      `);
    }
    return msg.reply('❌ **Invalid or Used Code** — Ask Bot Owner for a new code');
  }

  // ──── PREFIX & LOG ────
  if(cmd === 'setprefix') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return msg.reply('❌ No permission');
    if(!args[0]) return msg.reply(`Current Prefix: \`${prefix}\``);
    DB.setPrefix(msg.guild.id, args[0]);
    return msg.reply(`✅ Prefix changed to: \`${args[0]}\``);
  }
  if(cmd === 'setlogchannel') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    const cid = args[0]?.replace(/[<#>]/g,'');
    DB.setLog(msg.guild.id, cid);
    return msg.reply(`✅ Log channel: <#${cid}>`);
  }

  // ──── ANTINUKE ────
  if(cmd === 'antinuke') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return msg.reply('❌ No permission');
    if(args[0] === 'enable') { DB.setAntinuke(msg.guild.id, {enabled:true}); return msg.reply('✅ Antinuke Enabled'); }
    if(args[0] === 'disable') { DB.setAntinuke(msg.guild.id, {enabled:false}); return msg.reply('⚠️ Antinuke Disabled'); }
    if(args[0] === 'strict') {
      if(!DB.isPremium(msg.guild.id)) return msg.reply('🔒 Premium Required — `!activate <code>`');
      const mode = args[1] === 'on';
      DB.setAntinuke(msg.guild.id, {strict:mode});
      return msg.reply(`✅ Strict Mode: **${mode?'🔴 ON — Auto-ban':'🟡 OFF — Monitor only'}**`);
    }
  }

  // ──── WHITELIST ────
  if(cmd === 'whitelist' || cmd === 'wl') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    if(args[0] === 'add') {
      const u = msg.mentions.users.first() || await client.users.fetch(args[1]).catch(()=>null);
      if(!u) return msg.reply(`Usage: ${prefix}whitelist add @user`);
      DB.whitelistAdd(msg.guild.id, u.id);
      return msg.reply(`✅ Added **${u.username}** to whitelist`);
    }
    if(args[0] === 'remove') {
      const u = msg.mentions.users.first() || await client.users.fetch(args[1]).catch(()=>null);
      DB.whitelistRemove(msg.guild.id, u.id);
      return msg.reply(`✅ Removed **${u.username}** from whitelist`);
    }
  }
  if(cmd === 'multiwl') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    let n=0; args.forEach(id=>{ if(id.length>10){ DB.whitelistAdd(msg.guild.id,id); n++; }});
    return msg.reply(`✅ Whitelisted **${n}** users`);
  }
  if(cmd === 'multiunwl') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    let n=0; args.forEach(id=>{ if(id.length>10){ DB.whitelistRemove(msg.guild.id,id); n++; }});
    return msg.reply(`✅ Unwhitelisted **${n}** users`);
  }

  // ──── MODERATION ────
  if(cmd === 'purge') {
    if(!msg.member.permissions.has('ManageMessages')) return;
    const n = parseInt(args[0]);
    if(isNaN(n)||n<1||n>100) return msg.reply(`Usage: ${prefix}purge 50`);
    const d = await msg.channel.bulkDelete(n, true).catch(()=>null);
    return msg.reply(`✅ Deleted **${d?.size||0}** messages`).then(m=>setTimeout(()=>m.delete(),3000));
  }
  if(cmd === 'ban') {
    if(!msg.member.permissions.has('BanMembers')) return;
    const u = msg.mentions.members.first();
    if(!u) return msg.reply(`Usage: ${prefix}ban @user`);
    await u.ban({reason:args.slice(1).join(' ')||'No reason'}).catch(()=>null);
    return msg.reply(`✅ Banned **${u.user.username}**`);
  }
  if(cmd === 'unban') {
    if(!msg.member.permissions.has('BanMembers')) return;
    try { await msg.guild.bans.remove(args[0]); return msg.reply('✅ Unbanned'); } catch { return msg.reply('❌ Not found'); }
  }
  if(cmd === 'kick') {
    if(!msg.member.permissions.has('KickMembers')) return;
    const u = msg.mentions.members.first();
    if(!u) return;
    await u.kick().catch(()=>null);
    return msg.reply(`✅ Kicked **${u.user.username}**`);
  }
  if(cmd === 'multiban') {
    if(!msg.member.permissions.has('BanMembers')) return;
    let ok=0; for(const id of args) try { await msg.guild.members.ban(id); ok++; } catch {}
    return msg.reply(`✅ Banned **${ok}/${args.length}**`);
  }
  if(cmd === 'multiunban') {
    if(!msg.member.permissions.has('BanMembers')) return;
    let ok=0; for(const id of args) try { await msg.guild.bans.remove(id); ok++; } catch {}
    return msg.reply(`✅ Unbanned **${ok}/${args.length}**`);
  }

  // ──── 🎭 PREMIUM ROLES ────
  if(cmd === 'makerole' || cmd === 'createrole') {
    if(!DB.isPremium(msg.guild.id)) return msg.reply('🔒 Premium Only — `!activate <code>`');
    if(!msg.member.permissions.has('ManageRoles')) return;
    const name = args.join(' ') || 'New Role';
    const r = await msg.guild.roles.create({name, color: '#23a559'}).catch(()=>null);
    return msg.reply(r ? `✅ Created role: **${r.name}**` : '❌ Failed');
  }
  if(cmd === 'deleterole') {
    if(!DB.isPremium(msg.guild.id)) return msg.reply('🔒 Premium Only — `!activate <code>`');
    if(!msg.member.permissions.has('ManageRoles')) return;
    const r = msg.mentions.roles.first() || msg.guild.roles.cache.get(args[0]);
    if(!r) return msg.reply(`Usage: ${prefix}deleterole @role`);
    await r.delete().catch(()=>null);
    return msg.reply(`✅ Deleted: **${r.name}**`);
  }

  // ──── 🖼️ PREMIUM BOT PFP (SERVER-ONLY) ────
  if(cmd === 'setbotpfp') {
    if(!DB.isPremium(msg.guild.id)) return msg.reply('🔒 Premium Only — `!activate <code>`');
    const url = args[0] || msg.attachments.first()?.url;
    if(!url) return msg.reply(`Usage: ${prefix}setbotpfp <imageURL>`);
    try {
      await client.user.setAvatar(url);
      return msg.reply('✅ Bot Avatar Updated\n💡 Only changes in THIS server — NOT global');
    } catch { return msg.reply('❌ Failed — Use direct image URL'); }
  }

  // ──── BASIC ────
  if(cmd === 'ping') {
    const s = Date.now(); await msg.reply('Pong...');
    return msg.editReply(`🏓 Pong! Latency: **${Date.now()-s}ms**`);
  }
  if(cmd === 'serverinfo') {
    return msg.reply(`🏰 **${msg.guild.name}**\nMembers: **${msg.guild.memberCount}**\nPrefix: \`${prefix}\``);
  }
});

// ==============================================
// READY
// ==============================================
client.on('ready', () => {
  console.log(`\n✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Owner Code Gen: !gencode`);
  console.log(`✅ Credits to WIKO — Online!\n`);
});

client.login(config.token).catch(e => {
  console.error('❌ Login failed — Check config.json token');
});