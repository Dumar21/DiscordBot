const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ROL_VERIFICADO_ID = '1531074770722881697';
const EDAD_MINIMA_DIAS = 7;

async function enviarPanelVerificacion(client) {
  const canal = await client.channels.fetch(process.env.VERIFY_CHANNEL_ID).catch(() => null);
  if (!canal) {
    console.error('❌ ERROR: Canal de verificación no encontrado. Revisa el VERIFY_CHANNEL_ID en .env');
    return;
  }

  const mensajes = await canal.messages.fetch({ limit: 10 }).catch(() => null);
  const yaExiste = mensajes?.find(
    (m) => m.author.id === client.user.id && m.embeds[0]?.title === 'Verificación'
  );
  if (yaExiste) return;

  const embed = new EmbedBuilder()
    .setTitle('Verificación')
    .setDescription('Dale clic al botón para verificarte y desbloquear el servidor.')
    .setColor(0x2b2d31);

  const boton = new ButtonBuilder()
    .setCustomId('verificarme')
    .setLabel('Verificarme')
    .setStyle(ButtonStyle.Success);

  const fila = new ActionRowBuilder().addComponents(boton);

  await canal.send({ embeds: [embed], components: [fila] });
  console.log('✅ Panel de verificación enviado.');
}

async function manejarInteraccionVerificacion(interaction) {
  if (!interaction.isButton() || interaction.customId !== 'verificarme') return;

  const miembro = interaction.member;

  if (miembro.roles.cache.has(ROL_VERIFICADO_ID)) {
    await interaction.reply({ content: 'Ya estás verificado.', ephemeral: true });
    return;
  }

  const edadCuentaMs = Date.now() - interaction.user.createdTimestamp;
  const edadMinimaMs = EDAD_MINIMA_DIAS * 24 * 60 * 60 * 1000;

  if (edadCuentaMs < edadMinimaMs) {
    await interaction.reply({
      content: `❌ Tu cuenta es muy nueva para verificarte. Debe tener al menos ${EDAD_MINIMA_DIAS} días.`,
      ephemeral: true,
    });
    return;
  }

  try {
    await miembro.roles.add(ROL_VERIFICADO_ID);
    await interaction.reply({ content: '✅ Verificación completada. ¡Bienvenid@!', ephemeral: true });
  } catch (error) {
    console.error(`❌ Error al verificar a ${interaction.user.username}:`, error);
    await interaction.reply({ content: '❌ Hubo un error al verificarte, contacta a un admin.', ephemeral: true });
  }
}

module.exports = { enviarPanelVerificacion, manejarInteraccionVerificacion };