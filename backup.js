const { ChannelType } = require('discord.js');
const path = require('path');
const fs = require('fs');

const RUTA_BACKUP = path.join(__dirname, 'backup.json');

async function guardarBackup(guild) {
  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      nombre: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permisos: r.permissions.bitfield.toString(),
      posicion: r.position,
    }));

  const canales = guild.channels.cache
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      nombre: c.name,
      tipo: c.type,
      posicion: c.position,
      categoriaNombre: c.parent ? c.parent.name : null,
      topico: c.topic || null,
      nsfw: c.nsfw || false,
      bitrate: c.bitrate || null,
      userLimit: c.userLimit || null,
      permisos: c.permissionOverwrites
        ? c.permissionOverwrites.cache.map((po) => ({
            id: po.id,
            tipo: po.type,
            nombreRol: po.type === 0 ? guild.roles.cache.get(po.id)?.name ?? null : null,
            allow: po.allow.bitfield.toString(),
            deny: po.deny.bitfield.toString(),
          }))
        : [],
    }));

  const backup = { guardadoEn: Date.now(), roles, canales };
  fs.writeFileSync(RUTA_BACKUP, JSON.stringify(backup, null, 2));
  console.log(`💾 Backup guardado: ${roles.length} roles, ${canales.length} canales.`);
  return backup;
}

async function restaurarServidor(guild) {
  if (!fs.existsSync(RUTA_BACKUP)) {
    console.error('❌ No existe backup.json, no se puede restaurar.');
    return;
  }

  const backup = JSON.parse(fs.readFileSync(RUTA_BACKUP, 'utf8'));

  for (const rolBackup of backup.roles) {
    const existe = guild.roles.cache.find((r) => r.name === rolBackup.nombre);
    if (existe) continue;
    try {
      await guild.roles.create({
        name: rolBackup.nombre,
        color: rolBackup.color,
        hoist: rolBackup.hoist,
        mentionable: rolBackup.mentionable,
        permissions: BigInt(rolBackup.permisos),
      });
      console.log(`🔧 Rol recreado: ${rolBackup.nombre}`);
    } catch (error) {
      console.error(`❌ Error al recrear rol ${rolBackup.nombre}:`, error);
    }
  }

  const categoriasBackup = backup.canales.filter((c) => c.tipo === ChannelType.GuildCategory);
  for (const catBackup of categoriasBackup) {
    const existe = guild.channels.cache.find(
      (c) => c.name === catBackup.nombre && c.type === ChannelType.GuildCategory
    );
    if (existe) continue;
    try {
      await guild.channels.create({
        name: catBackup.nombre,
        type: ChannelType.GuildCategory,
      });
      console.log(`🔧 Categoría recreada: ${catBackup.nombre}`);
    } catch (error) {
      console.error(`❌ Error al recrear categoría ${catBackup.nombre}:`, error);
    }
  }

  const canalesBackup = backup.canales.filter((c) => c.tipo !== ChannelType.GuildCategory);
  for (const canalBackup of canalesBackup) {
    const existe = guild.channels.cache.find(
      (c) => c.name === canalBackup.nombre && c.type === canalBackup.tipo
    );
    if (existe) continue;

    const categoriaPadre = canalBackup.categoriaNombre
      ? guild.channels.cache.find(
          (c) => c.name === canalBackup.categoriaNombre && c.type === ChannelType.GuildCategory
        )
      : null;

    const overwrites = canalBackup.permisos.map((po) => {
      let id = po.id;
      if (po.tipo === 0 && po.nombreRol) {
        const rol = guild.roles.cache.find((r) => r.name === po.nombreRol);
        if (rol) id = rol.id;
      }
      return {
        id,
        type: po.tipo,
        allow: BigInt(po.allow),
        deny: BigInt(po.deny),
      };
    });

    try {
      await guild.channels.create({
        name: canalBackup.nombre,
        type: canalBackup.tipo,
        parent: categoriaPadre ? categoriaPadre.id : null,
        topic: canalBackup.topico || undefined,
        nsfw: canalBackup.nsfw,
        bitrate: canalBackup.bitrate || undefined,
        userLimit: canalBackup.userLimit || undefined,
        permissionOverwrites: overwrites,
      });
      console.log(`🔧 Canal recreado: ${canalBackup.nombre}`);
    } catch (error) {
      console.error(`❌ Error al recrear canal ${canalBackup.nombre}:`, error);
    }
  }
}

module.exports = { guardarBackup, restaurarServidor };