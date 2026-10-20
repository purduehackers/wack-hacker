import { otelIntegration } from "eve/instrumentation/otel";

export default otelIntegration({
  runtimeContext: ({ session, turn }) => ({
    "gen_ai.conversation.id": session.id,
    "wack.turn_id": turn.id,
    "wack.turn_sequence": turn.sequence,
  }),
});
