import { ButtonStyle, ComponentType, TextInputStyle } from "discord.js";
import type {
  APIActionRowComponent,
  APIButtonComponent,
  APIButtonComponentWithCustomId,
  APIComponentInMessageActionRow,
  APIModalInteractionResponseCallbackData,
  APITextInputComponent,
  Message,
} from "discord.js";

export function button(
  label: string,
  customId: string,
  style: APIButtonComponentWithCustomId["style"] = ButtonStyle.Secondary,
): APIButtonComponent {
  return { type: ComponentType.Button, label, custom_id: customId, style };
}

export function link(label: string, url: string): APIButtonComponent {
  return { type: ComponentType.Button, label, url, style: ButtonStyle.Link };
}

export function row(
  ...components: APIComponentInMessageActionRow[]
): APIActionRowComponent<APIComponentInMessageActionRow> {
  return { type: ComponentType.ActionRow, components };
}

export function textModal(
  customId: string,
  title: string,
  fields: {
    label: string;
    description: string;
    input: Omit<APITextInputComponent, "type" | "style">;
  }[],
): APIModalInteractionResponseCallbackData {
  return {
    custom_id: customId,
    title,
    components: fields.map(({ label, description, input }) => ({
      type: ComponentType.Label,
      label,
      description,
      component: { type: ComponentType.TextInput, style: TextInputStyle.Short, ...input },
    })),
  };
}

export function messageControls(message: Pick<Message, "components">) {
  return message.components.flatMap((entry) =>
    entry.type === ComponentType.ActionRow ? entry.components : [],
  );
}
