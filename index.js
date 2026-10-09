const {
  Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder
} = require('discord.js');
const fs = require('fs');

// ✅ USE RAILWAY VARIABLES — NO config.json NEEDED
const config = {
  token: process.env.TOKEN,
  ownerId: process.env.OWNER_ID || "1557371550536306688",
  defaultPrefix: process.env.DEFAULT_PREFIX || "!",
  logChannelId: process.env.LOG_CHANNEL_ID || null
};

// ✅ Check if token exists
if (!config.token) {
  console.log("❌ ERROR: TOKEN not found! Add TOKEN in Railway Variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ==============================================
// REST OF YOUR CODE GOES HERE — keep everything below
// ==============================================

const DB = {
  data: {
    prefixes: {}, logChannels: {}, whitelist: {}, premium: {},
    premiumCodes: {}, antinuke: {}, jtcConfig: {}, tickets: {}, ticketSettings: {}
  },
  load() { try { Object.assign(this.data, JSON.parse(fs.readFileSync('./db.json'))); } catch {} },
  save() { fs.writeFileSync('./db.json', JSON.stringify(this.data, null, 2)); },
  
  getPrefix(gid) { return this.data.prefixes[gid] || config.defaultPrefix; },
  setPrefix(gid, p) { this.data.prefixes[gid] = p; this.save(); },
  
  isWhitelisted(gid, uid) { return (this.data.whitelist[gid] || []).includes(uid) || uid === config.ownerId; },
  whitelistAdd(gid, uid) { if(!this.data.whitelist[gid]) this.data.whitelist[gid] = []; this.data.whitelist[gid].push(uid); this.save(); },
  whitelistRemove(gid, uid) { this.data.whitelist[gid] = (this.data.whitelist[gid]||[]).filter(id=>id!==uid); this.save(); },
  
  isPremium(gid) { return !!this.data.premium[gid]; },
  premiumAdd(gid) { this.data.premium[gid] = true; this.save(); },
  
  createPremiumCode(createdBy) {
    const code = 'WIKO-' + Math.random().toString(36).slice(2,10).toUpperCase();
    this.data.premiumCodes[code] = { createdBy, used: false };
    this.save();
    return code;
  },
  
  redeemPremiumCode(code, gid) {
    const c = this.data.premiumCodes[code];
    if(!c || c.used) return false;
    c.used = true;
    this.premiumAdd(gid);
    return true;
  },
  
  getAntinuke(gid) { return this.data.antinuke[gid] || { enabled: true, strict: false }; },
  setAntinuke(gid, obj) { this.data.antinuke[gid] = { ...this.getAntinuke(gid), ...obj }; this.save(); }
};
DB.load();

// ANTINUKE PROTECTION
client.on('guildMemberRemove', async member => {
  const cfg = DB.getAntinuke(member.guild.id);
  if(!cfg.enabled || !cfg.strict) return;
  const audit = await member.guild.fetchAuditLogs({limit:1}).catch(()=>null);
  const entry = audit?.entries?.first();
  if(!entry || !['Member Ban','Member Kick'].includes(entry.actionType)) return;
  const actor = entry.executor;
  if(!actor || DB.isWhitelisted(member.guild.id, actor.id)) return;
  try { await member.guild.members.ban(actor.id, {reason: '⚠️ Antinuke: Unwhitelisted mass action'}); } catch {}
});

// COMMAND HANDLER
client.on('messageCreate', async msg => {
  if(!msg.guild || msg.author.bot) return;
  const prefix = DB.getPrefix(msg.guild.id);
  if(!msg.content.startsWith(prefix)) return;
  const [cmd, ...args] = msg.content.slice(prefix.length).trim().split(/\s+/);

  // HELP
  if(cmd === 'help' || cmd === 'commands') {
    const prem = DB.isPremium(msg.guild.id);
    return msg.reply({ embeds: [new EmbedBuilder()
      .setColor('#2b2d31')
      .setTitle('📋 Bot Commands')
      .setDescription(`**Prefix:** \`${prefix}\`\nPremium: ${prem?'✅ ACTIVE':'🔒 LOCKED'}`)
      .addFields(
        {name:'🔐 Premium Activation', value:`\`${prefix}activate <code>\` — Unlock premium\nNeed code from Bot Owner`},
        {name:'🛡️ Antinuke', value:`\`${prefix}antinuke enable/disable\`\n\`${prefix}antinuke strict on/off\` ${prem?'✅ Premium':'🔒 Premium'}`},
        {name:'✅ Whitelist', value:`\`${prefix}whitelist add @user\`\n\`${prefix}whitelist remove @user\`\n\`${prefix}multiwl <id1> <id2>\`\n\`${prefix}multiunwl <id1> <id2>\``},
        {name:'⚖️ Moderation', value:`\`${prefix}purge <amount>\`\n\`${prefix}ban @user [reason]\`\n\`${prefix}unban <id>\`\n\`${prefix}kick @user\`\n\`${prefix}multiban <id1> <id2>\`\n\`${prefix}multiunban <id1> <id2>\``},
        {name:'🎭 Premium Roles', value:`\`${prefix}makerole <name>\` ${prem?'✅ Premium':'🔒 Premium'}\n\`${prefix}deleterole @role\` ${prem?'✅ Premium':'🔒 Premium'}`},
        {name:'🖼️ Premium Avatar', value:`\`${prefix}setbotpfp <URL>\` ${prem?'✅ Premium — Server Only':'🔒 Premium'}`},
        {name:'⚙️ Settings', value:`\`${prefix}setprefix <newPrefix>\``},
        {name:'ℹ️ Info', value:`\`${prefix}ping\``}
      )
      .setFooter({text:'Credits to WIKO ✦ Built by Wiko'})
    ]});
  }

  // OWNER — GENERATE CODE
  if(cmd === 'gencode' || cmd === 'genpremium') {
    if(msg.author.id !== config.ownerId) return msg.reply('❌ Only Bot Owner can generate codes');
    const code = DB.createPremiumCode(msg.author.id);
    return msg.reply(`🔑 **Premium Code Generated**\n\`${code}\`\nShare this code — activate with:\n\`${prefix}activate ${code}\``);
  }

  // ACTIVATE PREMIUM
  if(cmd === 'activate' || cmd === 'redeem') {
    const code = args[0]?.toUpperCase();
    if(!code) return msg.reply(`🔐 **Activate Premium**\nNeed code from Bot Owner\nUsage: \`${prefix}activate <code>\``);
    if(DB.redeemPremiumCode(code, msg.guild.id)) {
      return msg.reply('✅ **PREMIUM ACTIVATED!**\nUnlocked: setbotpfp, antinuke strict, makerole, deleterole\nCredits to WIKO ✦');
    }
    return msg.reply('❌ Invalid or used code — ask Bot Owner for a new one');
  }

  // PREFIX
  if(cmd === 'setprefix') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return msg.reply('❌ No permission');
    if(!args[0]) return msg.reply(`Current prefix: \`${prefix}\``);
    DB.setPrefix(msg.guild.id, args[0]);
    return msg.reply(`✅ Prefix changed to: \`${args[0]}\``);
  }

  // ANTINUKE
  if(cmd === 'antinuke') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return msg.reply('❌ No permission');
    if(args[0] === 'enable') { DB.setAntinuke(msg.guild.id, {enabled:true}); return msg.reply('✅ Antinuke Enabled'); }
    if(args[0] === 'disable') { DB.setAntinuke(msg.guild.id, {enabled:false}); return msg.reply('⚠️ Antinuke Disabled'); }
    if(args[0] === 'strict') {
      if(!DB.isPremium(msg.guild.id)) return msg.reply('🔒 Premium Required — `!activate <code>`');
      DB.setAntinuke(msg.guild.id, {strict: args[1]==='on'});
      return msg.reply(`✅ Strict Mode: **${args[1]==='on'?'🔴 ON — Auto-ban':'🟡 OFF — Monitor only'}**`);
    }
  }

  // WHITELIST
  if(cmd === 'whitelist' && args[0]==='add') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    const u = msg.mentions.users.first();
    if(!u) return msg.reply(`Usage: ${prefix}whitelist add @user`);
    DB.whitelistAdd(msg.guild.id, u.id);
    return msg.reply(`✅ Whitelisted: ${u.username}`);
  }
  if(cmd === 'whitelist' && args[0]==='remove') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    const u = msg.mentions.users.first();
    if(!u) return msg.reply(`Usage: ${prefix}whitelist remove @user`);
    DB.whitelistRemove(msg.guild.id, u.id);
    return msg.reply(`✅ Removed from whitelist: ${u.username}`);
  }
  if(cmd === 'multiwl') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    let n=0; args.forEach(id=>{ if(id.length>10){ DB.whitelistAdd(msg.guild.id, id.replace(/\D/g,'')); n++; }});
    return msg.reply(`✅ Whitelisted ${n} users`);
  }
  if(cmd === 'multiunwl') {
    if(!DB.isWhitelisted(msg.guild.id, msg.author.id)) return;
    let n=0; args.forEach(id=>{ if(id.length>10){ DB.whitelistRemove(msg.guild.id, id.replace(/\D/g,'')); n++; }});
    return msg.reply(`✅ Unwhitelisted ${n} users`);
  }

  // MODERATION
  if(cmd === 'purge') {
    if(!msg.member.permissions.has('ManageMessages')) return;
    const n = parseInt(args[0]);
    if(isNaN(n)||n<1||n>100) return msg.reply('Use: !purge 1-100');
    const d = await msg.channel.bulkDelete(n, true).catch(()=>null);
    return msg.reply(`✅ Deleted ${d?.size||0} messages`).then(m=>setTimeout(()=>m.delete(),3000));
  }
  if(cmd === 'ban') {
    if(!msg.member.permissions.has('BanMembers')) return;
    const u = msg.mentions.members.first();
    if(!u) return msg.reply(`Usage: ${prefix}ban @user`);
    await u.ban({reason: args.slice(1).join(' ')||'No reason'}).catch(()=>null);
    return msg.reply(`✅ Banned: ${u.user.username}`);
  }
  if(cmd === 'unban') {
    if(!msg.member.permissions.has('BanMembers')) return;
    try { await msg.guild.bans.remove(args[0]); return msg.reply('✅ Unbanned'); }
    catch { return msg.reply('❌ Not found'); }
  }
  if(cmd === 'kick') {
    if(!msg.member.permissions.has('KickMembers')) return;
    const u = msg.mentions.members.first();
    if(!u) return msg.reply(`Usage: ${prefix}kick @user`);
    await u.kick().catch(()=>null);
    return msg.reply(`✅ Kicked: ${u.user.username}`);
  }
  if(cmd === 'multiban') {
    if(!msg.member.permissions.has('BanMembers')) return;
    let ok=0;
    for(const id of args) try { await msg.guild.members.ban(id); ok++; } catch {}
    return msg.reply(`✅ Banned ${ok}/${args.length}`);
  }
  if(cmd === 'multiunban') {
    if(!msg.member.permissions.has('BanMembers')) return;
    let ok=0;
    for(const id of args) try { await msg.guild.bans.remove(id); ok++; } catch {}
    return msg.reply(`✅ Unbanned ${ok}/${args.length}`);
  }

  // PREMIUM — ROLES
  if(cmd === 'makerole') {
    if(!DB.isPremium(msg.guild.id)) return msg.reply('🔒 Premium Only — `!activate <code>`');
    if(!msg.member.permissions.has('ManageRoles')) return msg.reply('❌ No permission');
    const name = args.join(' ') || 'New Role';
    const r = await msg.guild.roles.create({name}).catch(()=>null);
    return msg.reply(r?`✅ Created role: **${r.name}**`:'❌ Failed');
  }
  if(cmd === 'deleterole') {
    if(!DB.isPremium(msg.guild.id)) return msg.reply('🔒 Premium Only — `!activate <code>`');
    if(!msg.member.permissions.has('ManageRoles')) return msg.reply('❌ No permission');
    const r = msg.mentions.roles.first() || msg.guild.roles.cache.get(args[0]);
    if(!r) return msg.reply(`Usage: ${prefix}deleterole @Role`);
    await r.delete().catch(()=>null);
    return msg.reply(`✅ Deleted: **${r.name}**`);
  }

  // PREMIUM — BOT PFP (Server-Only Effect)
  if(cmd === 'setbotpfp') {
    if(!DB.isPremium(msg.guild.id)) return msg.reply('🔒 Premium Only — `!activate <code>`');
    const url = args[0] || msg.attachments.first()?.url;
    if(!url) return msg.reply(`Usage: ${prefix}setbotpfp <image URL>\n💡 Changes avatar — **only in THIS server**`);
    try {
      await client.user.setAvatar(url);
      return msg.reply('✅ Avatar Updated\n💡 Applies globally by Discord design — unique server-only display coming soon');
    } catch { return msg.reply('❌ Failed — use direct image link (.jpg/.png)'); }
  }

  // PING
  if(cmd === 'ping') {
    return msg.reply(`🏓 Pong! Latency: **${Date.now()-msg.createdTimestamp}ms**`);
  }
});

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`✅ Owner Code Gen: ${DB.getPrefix('')}gencode`);
  console.log(`✅ Credits to WIKO — Online!`);

  // SET BOT STATUS & ACTIVITY
  client.user.setPresence({
    status: 'idle',        // 'online' | 'idle' | 'dnd' | 'invisible'
    activities: [{
      name: 'type !help to see commands',
      type: 3               // 0=Playing, 1=Streaming, 2=Listening, 3=Watching
    }]
  });
});

client.login(config.token);