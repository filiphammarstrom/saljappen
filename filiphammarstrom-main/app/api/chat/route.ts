import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `Du är en hjälpsam assistent som hjälper svenska användare att sälja saker på Blocket och liknande marknadsplatser.

Arbetsflöde:
1. Analysera bilden noggrant → identifiera föremålet tydligt → ställ MAX 2 korta, konkreta frågor (t.ex. skick? medföljer tillbehör? vilket år/modell?)
2. När du fått svaren → använd web_search för att söka på Blocket och Tradera efter liknande föremål och hitta marknadspriset
3. Presentera kortfattat vad du hittade och föreslå ett rimligt pris
4. Skriv sedan en färdig annons. Börja annonsen EXAKT med texten "## Annons" på en egen rad, följt av:
   **Titel:** (max 60 tecken, säljande)
   **Beskrivning:** (3-5 meningar, lyft fram fördelarna)
   **Pris:** (ditt rekommenderade pris i SEK)
   **Kategori:** (lämplig Blocket-kategori)

Skriv alltid på svenska. Var konkret, positiv och effektiv. Undvik onödigt flum.`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  try {
    const { messages, image } = await req.json() as {
      messages: ChatMessage[];
      image?: string; // base64 data URL, e.g. "data:image/jpeg;base64,..."
    };

    // Build Anthropic message format
    const anthropicMessages: Anthropic.MessageParam[] = messages.map((msg, idx) => {
      // First user message gets the image attached
      if (idx === 0 && msg.role === "user" && image) {
        const base64Data = image.split(",")[1] ?? image;
        const mediaType = image.startsWith("data:image/png") ? "image/png"
          : image.startsWith("data:image/gif") ? "image/gif"
          : image.startsWith("data:image/webp") ? "image/webp"
          : "image/jpeg";

        return {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Data },
            },
            { type: "text", text: msg.content },
          ],
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (text: string) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        };

        let currentMessages = [...anthropicMessages];
        let iterations = 0;
        const MAX_ITERATIONS = 5;

        while (iterations < MAX_ITERATIONS) {
          iterations++;

          const messageStream = client.messages.stream({
            model: "claude-opus-4-6",
            max_tokens: 4096,
            thinking: { type: "adaptive" },
            system: SYSTEM_PROMPT,
            tools: [{ type: "web_search_20260209", name: "web_search" }],
            messages: currentMessages,
          });

          let fullText = "";

          for await (const event of messageStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send(event.delta.text);
              fullText += event.delta.text;
            }
          }

          const finalMsg = await messageStream.finalMessage();

          if (finalMsg.stop_reason !== "pause_turn") {
            break;
          }

          // Handle pause_turn: append assistant response and continue
          currentMessages = [
            ...currentMessages,
            { role: "assistant", content: finalMsg.content },
          ];
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return new Response(
      JSON.stringify({ error: "Något gick fel. Försök igen." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
