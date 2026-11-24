const { AuditLogEvent } = require('discord.js');
const { restaurarServidor } = require('./backup');

const VENTANA_MS = 10000;
const UMBRAL = 3;
const WHITELIST_IDS = [];

const registro = new Map();
let restaurando = false;

function registrarEvento(executorId) {
  const ahora = Date.now();
  const entradas = registro.get(executorId) || [];
  const filtradas = entradas.filter((t) => ahora - t < VENTANA_MS);
  filtradas.push(ahora);
  registro.set(executorId, filtradas);
  return filtradas.length;
}

async function obtenerEjecutor(guild, tipoEvento, objetivoId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: tipoEvento, limit: 5 });
    const entrada = logs.entries.find(
      (e) => e.target?.id === objetivoId && Date.now() - e.createdTimestamp < VENTANA_MS
    );
    return entrada ? entrada.executor : null;
  } catch (error) {
    console.error('❌ Error al leer audit logs:', error);
    return null;
  }
}

async function manejarEventoDestructivo(guild, executor) {
  if (!executor) return;
  if (executor.id === guild.client.user.id) return;
  if (WHITELIST_IDS.includes(executor.id)) return;

  const conteo = registrarEvento(executor.id);
  if (conteo < UMBRAL) return;

  console.log(`🚨 Raid detectado: ${executor.tag} superó el límite de eliminaciones.`);
  registro.delete(executor.id);

  try {
    const miembro = await guild.members.fetch(executor.id);
    await miembro.ban({ reason: 'Anti-Raid: eliminación masiva de canales/roles' });
    console.log(`🔨 ${executor.tag} baneado por Anti-Raid.`);
  } catch (error) {
    console.error(`❌ No se pudo banear a ${executor.tag}:`, error);
  }

  if (restaurando) return;
  restaurando = true;
  console.log('🛠️ Iniciando reconstrucción automática del servidor...');

  try {
    await restaurarServidor(guild);
    console.log('✅ Servidor reconstruido.');
  } catch (error) {
    console.error('❌ Error al reconstruir el servidor:', error);
  } finally {
    restaurando = false;
  }
}

function setupAntiRaid(client) {
  client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const executor = await obtenerEjecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    await manejarEventoDestructivo(channel.guild, executor);
  });

  client.on('roleDelete', async (role) => {
    const executor = await obtenerEjecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    await manejarEventoDestructivo(role.guild, executor);
  });

  console.log('🛡️ Anti-Raid activo.');
}

module.exports = { setupAntiRaid };