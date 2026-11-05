import { MessageFlags } from '@fluxerjs/core';

/** Every routine public bot message is silent and cannot generate a mention. */
export function silentMessage(content) {
  return {
    content,
    flags: MessageFlags.SuppressNotifications,
    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    ping: false,
    tts: false,
  };
}

export function quietReply(message, content) {
  return message.reply(silentMessage(content));
}

export function quietSend(message, content) {
  return message.send(silentMessage(content));
}
