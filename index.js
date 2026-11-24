require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { manejarComandoPlay, manejarComandoSkip } = require('./musica');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');
const { guardarBackup, restaurarServidor } = require('./backup');
const { setupAntiRaid } = require('./antiraid');
const { enviarPanelVerificacion, manejarInteraccionVerificacion } = require('./verificacion');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const ROL_MIEMBRO_ID = '1531074245516460163';
const ROL_BOT_ID = '1530791956316291092';

const mensajesBienvenida = [
  `Oe **{usuario}** bienvenid@ a**{servidor}**! Parchese`,
];

async function generarImagenBase(member, titulo, subtitulo) {
  const ANCHO = 960;
  const ALTO = 360;
  const canvas = createCanvas(ANCHO, ALTO);
  const ctx = canvas.getContext('2d');

  const rutaFondo = path.join(__dirname, 'welcome.jpg');
  if (fs.existsSync(rutaFondo)) {
    try {
      const fondoImg = await loadImage(rutaFondo);
      const escala = Math.max(ANCHO / fondoImg.width, ALTO / fondoImg.height);
      const w = fondoImg.width * escala;
      const h = fondoImg.height * escala;
      const x = (ANCHO - w) / 2;
      const y = (ALTO - h) / 2;
      ctx.drawImage(fondoImg, x, y, w, h);
    } catch (_) {}
  }

  const degradadoInferior = ctx.createLinearGradient(0, ALTO * 0.4, 0, ALTO);
  degradadoInferior.addColorStop(0, 'rgba(0,0,0,0)');
  degradadoInferior.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = degradadoInferior;
  ctx.fillRect(0, 0, ANCHO, ALTO);

  const avatarX = ANCHO / 2;
  const avatarY = 105;
  const radio = 75;

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, radio + 2, 0, Math.PI * 2);
  ctx.stroke();

  try {
    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatar = await loadImage(avatarURL);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, radio, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX - radio, avatarY - radio, radio * 2, radio * 2);
    ctx.restore();
  } catch (_) {
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, radio, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 60px Impact';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(member.user.username.charAt(0).toUpperCase(), avatarX, avatarY);
    ctx.textBaseline = 'alphabetic';
  }

  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.font = 'bold 64px Impact';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(titulo, avatarX, 245);

  const nombreUsuario = member.user.username.toUpperCase();
  const tamNombre = nombreUsuario.length > 18 ? 26 : 30;
  ctx.font = `bold ${tamNombre}px Arial`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(nombreUsuario, avatarX, 280);

  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(subtitulo, avatarX, 313);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  return canvas.toBuffer('image/png');
}

function generarImagenBienvenida(member) {
  return generarImagenBase(member, 'BIENVENID@', 'OEE!!! BIENVENID@, RECOCHE Y PARCHESE');
}

function generarImagenDespedida(member) {
  return generarImagenBase(member, 'ADIOS', 'SALIENDO ES SALIENDO');
}

function obtenerMensajeBienvenida(member) {
  const mensajeBase = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
  return mensajeBase
    .replace(/{usuario}/g, member.user.username)
    .replace(/{servidor}/g, member.guild.name)
    .replace(/{miembros}/g, member.guild.memberCount);
}

client.once('ready', async () => {
  console.log(`\n✅ Bot conectado como: ${client.user.tag}`);
  console.log(`📡 Servidores activos: ${client.guilds.cache.size}`);
  console.log(`🎯 Canal de bienvenida ID: ${process.env.WELCOME_CHANNEL_ID}`);
  console.log('─'.repeat(50));

  client.user.setPresence({
    activities: [{ name: '', type: 3 }],
    status: 'online',
  });

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    await guardarBackup(guild).catch((error) => console.error('❌ Error al guardar backup inicial:', error));
    setInterval(() => {
      guardarBackup(guild).catch((error) => console.error('❌ Error al guardar backup periódico:', error));
    }, 15 * 60 * 1000);
  }

  setupAntiRaid(client);
  await enviarPanelVerificacion(client);
});

client.on('interactionCreate', manejarInteraccionVerificacion);

client.on('guildMemberAdd', async (member) => {
  console.log(`\n👤 Nuevo miembro: ${member.user.username} se unió a ${member.guild.name}`);

  const rolId = member.user.bot ? ROL_BOT_ID : ROL_MIEMBRO_ID;
  try {
    await member.roles.add(rolId);
  } catch (error) {
    console.error(`❌ Error al asignar rol a ${member.user.username}:`, error);
  }

  if (member.user.bot) return;

  const canalBienvenida = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);

  if (!canalBienvenida) {
    console.error('❌ ERROR: Canal de bienvenida no encontrado. Revisa el WELCOME_CHANNEL_ID en .env');
    return;
  }

  try {
    console.log('🎨 Generando imagen de bienvenida...');
    const imagenBuffer = await generarImagenBienvenida(member);
    const adjunto = new AttachmentBuilder(imagenBuffer, { name: 'bienvenida.png' });

    await canalBienvenida.send({
      content: `Oe ${member} ${obtenerMensajeBienvenida(member).replace(member.user.username, '').replace(/\*\*/g, '')}`,
      files: [adjunto],
    });

    console.log(`✅ Mensaje de bienvenida enviado para ${member.user.username}`);
  } catch (error) {
    console.error('❌ Error al enviar bienvenida:', error);
  }
});

client.on('guildMemberRemove', async (member) => {
  console.log(`\n👋 ${member.user.username} salió de ${member.guild.name}`);

  const canalDespedida = member.guild.channels.cache.get(process.env.FAREWELL_CHANNEL_ID);
  if (!canalDespedida) return;

  try {
    console.log('🎨 Generando imagen de despedida...');
    const imagenBuffer = await generarImagenDespedida(member);
    const adjunto = new AttachmentBuilder(imagenBuffer, { name: 'despedida.png' });

    await canalDespedida.send({
      content: `${member.user} ha dejado **${member.guild.name}**!`,
      files: [adjunto],
    });

    console.log(`✅ Mensaje de despedida enviado para ${member.user.username}`);
  } catch (error) {
    console.error('❌ Error al enviar despedida:', error);
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ─── Música ───────────────────────────────────────────────────────────────
  if (message.content.toLowerCase().startsWith('m!p ')) {
    const query = message.content.slice(4).trim();
    if (!query) return message.reply('❌ Escribe el nombre o enlace de la canción. Ej: `m!p never gonna give you up`');
    return manejarComandoPlay(message, query);
  }

  if (message.content.toLowerCase() === 'm!s') {
    return manejarComandoSkip(message);
  }
  // ──────────────────────────────────────────────────────────────────────────

  if (message.content === '!ping') {
    message.reply(`🏓 ¡Pong! Latencia: **${client.ws.ping}ms**`);
  }

  if (message.content === '!testbienvenida') {
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('❌ Solo los administradores pueden usar este comando.');
    }

    const canalBienvenida = message.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);

    if (!canalBienvenida) {
      return message.reply('❌ No encontré el canal de bienvenida. Revisa el WELCOME_CHANNEL_ID en .env');
    }

    console.log('🔧 Probando mensaje de bienvenida...');
    const miembroFalso = message.member;
    const imagenBuffer = await generarImagenBienvenida(miembroFalso);
    const adjunto = new AttachmentBuilder(imagenBuffer, { name: 'bienvenida.png' });

    await canalBienvenida.send({
      content: `Oe ${miembroFalso} bienvenid@ a **${miembroFalso.guild.name}**! Parchese`,
      files: [adjunto],
    });

    await message.reply('✅ Mensaje de prueba enviado al canal de bienvenida.');
  }

  if (message.content === '!testdespedida') {
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('❌ Solo los administradores pueden usar este comando.');
    }

    const canalDespedida = message.guild.channels.cache.get(process.env.FAREWELL_CHANNEL_ID);

    if (!canalDespedida) {
      return message.reply('❌ No encontré el canal de despedida. Revisa el FAREWELL_CHANNEL_ID en .env');
    }

    console.log('🔧 Probando mensaje de despedida...');
    const miembroFalso = message.member;
    const imagenBuffer = await generarImagenDespedida(miembroFalso);
    const adjunto = new AttachmentBuilder(imagenBuffer, { name: 'despedida.png' });

    await canalDespedida.send({
      content: `${miembroFalso.user} ha dejado **${miembroFalso.guild.name}**!`,
      files: [adjunto],
    });

    await message.reply('✅ Mensaje de prueba enviado al canal de despedida.');
  }

  if (message.content === '!backup') {
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('❌ Solo los administradores pueden usar este comando.');
    }
    await guardarBackup(message.guild);
    await message.reply('✅ Backup del servidor guardado.');
  }

  if (message.content === '!restaurar') {
    if (!message.member.permissions.has('Administrator')) {
      return message.reply('❌ Solo los administradores pueden usar este comando.');
    }
    await message.reply('🛠️ Restaurando servidor desde el último backup...');
    await restaurarServidor(message.guild);
    await message.reply('✅ Restauración completada.');
  }
});

client.login(process.env.TOKEN);