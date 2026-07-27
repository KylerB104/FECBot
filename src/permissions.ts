import type {
  ChatInputCommandInteraction,
  GuildMember,
  GuildMemberRoleManager,
} from "discord.js";
import type { AppConfig } from "./config.js";

function memberRoleIds(member: GuildMember): Set<string> {
  const roles = member.roles as GuildMemberRoleManager;
  return new Set(roles.cache.keys());
}

export function isElectionAdministrator(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
): boolean {
  if (config.ownerUserIds.has(interaction.user.id)) {
    return true;
  }
  if (!interaction.inCachedGuild()) {
    return false;
  }
  const roleIds = memberRoleIds(interaction.member);
  return [...config.adminRoleIds].some((roleId) => roleIds.has(roleId));
}

export function mayCampaign(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
): boolean {
  if (isElectionAdministrator(interaction, config)) {
    return true;
  }
  if (!interaction.inCachedGuild()) {
    return false;
  }
  return memberRoleIds(interaction.member).has(config.campaignerRoleId);
}
