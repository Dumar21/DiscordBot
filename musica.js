const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const prism = require('prism-media');

const servidores = new Map();

function obtenerEstado(guildId) {
  if (!servidores.has(guildId)) {
    servidores.set(guildId, {
      connection: null,
      player: null,
      queue: [],
      inactivityTimer: null,
      textChannel: null,
      currentProcess: null,
      currentFFmpeg: null,
    });
  }
  return servidores.get(guildId);
}

function limpiarRecursosAudio(guildId) {
  const estado = obtenerEstado(guildId);
  
  if (estado.currentProcess) {
    try { estado.currentProcess.kill('SIGKILL'); } catch (_) {}
    estado.currentProcess = null;
  }
  if (estado.currentFFmpeg) {
    try { estado.currentFFmpeg.destroy(); } catch (_) {}
    estado.currentFFmpeg = null;
  }
}

function iniciarTimerInactividad(guildId) {
  limpiarTimer(guildId);
  const estado = obtenerEstado(guildId);
  estado.inactivityTimer = setTimeout(() => {
    const est = obtenerEstado(guildId);
    if (est.queue.length === 0) {
      desconectar(guildId, '⏱️ Sin actividad por 3 minutos, me fui del canal.');
    }
  }, 3 * 60 * 1000);
}

function limpiarTimer(guildId) {
  const estado = obtenerEstado(guildId);
  if (estado.inactivityTimer) {
    clearTimeout(estado.inactivityTimer);
    estado.inactivityTimer = null;
  }
}

function desconectar(guildId, mensaje) {
  const estado = obtenerEstado(guildId);
  limpiarTimer(guildId);
  limpiarRecursosAudio(guildId);
  if (estado.player) try { estado.player.stop(true); } catch (_) {}
  if (estado.connection) try { estado.connection.destroy(); } catch (_) {}
  if (mensaje && estado.textChannel) estado.textChannel.send(mensaje).catch(() => {});
  servidores.delete(guildId);
}

function extraerVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v');
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0];
  } catch (_) {}
  return null;
}

const YTDLP_BASE_OPTS = {
  noCheckCertificates: true,
  noWarnings: true,
  preferFreeFormats: true,
};

async function resolverCancion(query) {
  let searchQuery;

  if (query.includes('youtube.com') || query.includes('youtu.be')) {
    const videoId = extraerVideoId(query);
    searchQuery = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : query;
  } else if (query.includes('spotify.com')) {
    try {
      const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(query)}`);
      const data = await res.json();
      searchQuery = `ytsearch1:${data.title}`;
    } catch {
      throw new Error('No pude obtener información de ese enlace de Spotify.');
    }
  } else if (query.includes('music.apple.com')) {
    try {
      const res = await fetch(`https://music.apple.com/oembed?url=${encodeURIComponent(query)}`);
      const data = await res.json();
      searchQuery = `ytsearch1:${data.title}`;
    } catch {
      const partes = query.split('/');
      const slug = partes[partes.length - 1] || partes[partes.length - 2];
      const nombre = decodeURIComponent(slug).replace(/-/g, ' ').replace(/\?.*/, '');
      searchQuery = `ytsearch1:${nombre}`;
    }
  } else {
    searchQuery = `ytsearch1:${query}`;
  }

  const info = await youtubedl(searchQuery, {
    ...YTDLP_BASE_OPTS,
    dumpSingleJson: true,
  });

  return {
    titulo: info.title,
    url: info.webpage_url ?? `https://www.youtube.com/watch?v=${info.id}`,
    duracion: info.duration ?? 0,
  };
}

function crearStream(guildId, url) {
  const estado = obtenerEstado(guildId);
  limpiarRecursosAudio(guildId);

  const proceso = youtubedl.exec(url, {
    ...YTDLP_BASE_OPTS,
    output: '-',
    format: 'bestaudio',
    quiet: true,
    bufferSize: '16K',
  });

  const ffmpeg = new prism.FFmpeg({
    args: [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-analyzeduration', '0',
      '-loglevel', '0',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
    ],
  });

  estado.currentProcess = proceso;
  estado.currentFFmpeg = ffmpeg;

  proceso.stdout.pipe(ffmpeg);
  proceso.stdout.on('error', () => {});
  ffmpeg.on('error', () => {});

  return ffmpeg;
}

async function reproducirSiguiente(guildId) {
  const estado = obtenerEstado(guildId);

  limpiarRecursosAudio(guildId);

  if (estado.queue.length === 0) {
    iniciarTimerInactividad(guildId);
    if (estado.textChannel) {
      estado.textChannel
        .send('Cola vacía. Me desconecto en **3 minutos** si nadie pide más canciones.')
        .catch(() => {});
    }
    return;
  }

  limpiarTimer(guildId);
  const cancion = estado.queue.shift();

  try {
    const audioStream = crearStream(guildId, cancion.url);
    const recurso = createAudioResource(audioStream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });

    estado.player.play(recurso);

    if (estado.textChannel) {
      const min = Math.floor(cancion.duracion / 60);
      const seg = String(cancion.duracion % 60).padStart(2, '0');
      const dur = cancion.duracion ? ` (\`${min}:${seg}\`)` : '';
      estado.textChannel
        .send(`Reproduciendo: **${cancion.titulo}**${dur}`)
        .catch(() => {});
    }
  } catch (error) {
    console.error('Error al reproducir:', error.message);
    if (estado.textChannel) {
      estado.textChannel
        .send(`No pude reproducir **${cancion.titulo}**. Saltando...`)
        .catch(() => {});
    }
    reproducirSiguiente(guildId);
  }
}

async function manejarComandoPlay(message, query) {
  const guildId = message.guild.id;
  const canalVoz = message.member.voice.channel;

  if (!canalVoz) {
    return message.reply('Tienes que estar en un canal de voz para pedir música.');
  }

  let cancion;
  const msgBuscando = await message.reply('Buscando canción...');
  try {
    cancion = await resolverCancion(query.trim());
    await msgBuscando.delete().catch(() => {});
  } catch (error) {
    await msgBuscando.delete().catch(() => {});
    return message.reply(`${error.message}`);
  }

  const estado = obtenerEstado(guildId);

  if (estado.connection) {
    const connState = estado.connection.state.status;
    if (
      connState === VoiceConnectionStatus.Ready ||
      connState === VoiceConnectionStatus.Signalling ||
      connState === VoiceConnectionStatus.Connecting
    ) {
      estado.queue.push(cancion);
      return message.reply(
        `Agregado a la cola (posición **${estado.queue.length}**): **${cancion.titulo}**`
      );
    }
  }

  const connection = joinVoiceChannel({
    channelId: canalVoz.id,
    guildId,
    adapterCreator: message.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  const player = createAudioPlayer();
  estado.connection = connection;
  estado.player = player;
  estado.textChannel = message.channel;
  estado.queue = [];

  connection.subscribe(player);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      desconectar(guildId, 'Me desconectaron del canal de voz.');
    }
  });

  player.on(AudioPlayerStatus.Idle, () => {
    reproducirSiguiente(guildId);
  });

  player.on('error', (error) => {
    console.error('Error del reproductor:', error.message);
    if (estado.textChannel) {
      estado.textChannel.send('Error de audio. Saltando canción...').catch(() => {});
    }
    reproducirSiguiente(guildId);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    desconectar(guildId);
    return message.reply('No pude conectarme al canal de voz. Intenta de nuevo.');
  }

  estado.queue.push(cancion);
  reproducirSiguiente(guildId);
}

async function manejarComandoSkip(message) {
  const guildId = message.guild.id;
  const estado = obtenerEstado(guildId);

  if (!estado.connection || !estado.player) {
    return message.reply('No hay ninguna canción reproduciéndose ahora.');
  }
  if (!message.member.voice.channel) {
    return message.reply('Tienes que estar en un canal de voz para usar este comando.');
  }

  estado.player.stop(); 
  return message.reply('Canción skipeada.');
}

module.exports = { manejarComandoPlay, manejarComandoSkip };