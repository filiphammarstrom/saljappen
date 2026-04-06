"use client";

import { useRef, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
}

type AppState = "idle" | "chatting" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseListingFromText(text: string): {
  title: string;
  description: string;
  price: string;
  category: string;
} | null {
  if (!text.includes("## Annons")) return null;
  const extract = (label: string) => {
    const re = new RegExp(`\\*{0,2}${label}\\*{0,2}:?\\s*(.+?)(?=\\n|$)`, "i");
    return text.match(re)?.[1]?.trim() ?? "";
  };
  return {
    title: extract("Titel"),
    description: extract("Beskrivning"),
    price: extract("Pris"),
    category: extract("Kategori"),
  };
}

// Render assistant text: bold (**…**), headings (##), line breaks
function renderAssistantText(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) {
      return (
        <p key={i} className="font-bold text-base mt-2">
          {line.slice(3)}
        </p>
      );
    }
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className={line === "" ? "mt-1" : undefined}>
        {parts.map((part, j) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={j}>{part.slice(2, -2)}</strong>
          ) : (
            part
          )
        )}
      </p>
    );
  });
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [image, setImage] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Image upload ────────────────────────────────────────────────────────────

  const handleImageSelect = useCallback(
    async (file: File) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        setImage(dataUrl);
        setAppState("chatting");

        const firstMessage: Message = {
          role: "user",
          content: "Vad är det här för sak och hur mycket tror du den är värd?",
        };
        setMessages([firstMessage]);
        await sendToApiInternal([firstMessage], dataUrl);
      };
      reader.readAsDataURL(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) handleImageSelect(file);
    },
    [handleImageSelect]
  );

  // ── API streaming ───────────────────────────────────────────────────────────

  const sendToApiInternal = async (
    msgs: Message[],
    img: string | null = image
  ) => {
    setIsLoading(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, image: img }),
      });

      if (!res.ok || !res.body) throw new Error("API-fel");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const { text } = JSON.parse(data) as { text: string };
            fullText += text;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: fullText,
              };
              return updated;
            });
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          } catch {
            // ignore malformed chunk
          }
        }
      }

      if (fullText.includes("## Annons")) {
        setAppState("done");
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: "Något gick fel. Kontrollera att ANTHROPIC_API_KEY är satt och försök igen.",
        };
        return updated;
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  };

  // ── Chat send ───────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    await sendToApiInternal(newMessages);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Copy listing ────────────────────────────────────────────────────────────

  const handleCopy = () => {
    const lastAssistant =
      [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
    const annonsPart = lastAssistant.split("## Annons")[1] ?? lastAssistant;
    navigator.clipboard.writeText("## Annons" + annonsPart).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Reset ───────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setAppState("idle");
    setImage(null);
    setMessages([]);
    setInput("");
    setCopied(false);
  };

  // ── Listing data ────────────────────────────────────────────────────────────

  const lastAssistantContent =
    [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const listing = parseListingFromText(lastAssistantContent);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
          S
        </div>
        <h1 className="font-semibold text-gray-900">Sälj-hjälparen</h1>
        {appState !== "idle" && (
          <button
            onClick={handleReset}
            className="ml-auto text-sm text-gray-500 hover:text-gray-700"
          >
            Börja om
          </button>
        )}
      </header>

      <main className="flex-1 flex flex-col max-w-2xl w-full mx-auto">

        {/* ── IDLE: Upload view ── */}
        {appState === "idle" && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Ta en bild, få ett pris
              </h2>
              <p className="text-gray-500 text-sm max-w-sm">
                Ladda upp en bild på det du vill sälja — AI:n identifierar
                föremålet, hittar marknadspriset och skriver annonsen åt dig.
              </p>
            </div>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-2xl p-12 flex flex-col items-center gap-4 cursor-pointer hover:border-orange-400 hover:bg-orange-50 transition-colors"
            >
              <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-orange-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-700">
                  Klicka för att välja bild
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  eller dra och släpp här · JPEG, PNG, WebP
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageSelect(file);
              }}
            />

            {/* How it works */}
            <div className="w-full grid grid-cols-3 gap-3 text-center text-xs text-gray-500">
              {[
                { emoji: "📸", label: "Ladda upp bild" },
                { emoji: "🔍", label: "AI söker priser" },
                { emoji: "✍️", label: "Annons klar" },
              ].map(({ emoji, label }) => (
                <div
                  key={label}
                  className="bg-white rounded-xl p-3 border border-gray-100"
                >
                  <div className="text-2xl mb-1">{emoji}</div>
                  <div>{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── CHATTING / DONE: Chat view ── */}
        {(appState === "chatting" || appState === "done") && (
          <div className="flex-1 flex flex-col" style={{ height: "calc(100vh - 57px)" }}>
            {/* Image strip */}
            {image && (
              <div className="px-4 pt-4 flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image}
                  alt="Uppladdad bild"
                  className="h-20 w-20 object-cover rounded-xl border border-gray-200 shadow-sm"
                />
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-orange-500 text-white rounded-br-sm"
                        : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      msg.content ? (
                        renderAssistantText(msg.content)
                      ) : (
                        isLoading && (
                          <span className="inline-flex gap-1 items-center py-1">
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                          </span>
                        )
                      )
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Listing card */}
            {appState === "done" && listing && (
              <div className="mx-4 mb-3 bg-white border border-orange-200 rounded-2xl p-4 shadow-sm flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
                    ✓ Annons klar
                  </span>
                  <button
                    onClick={handleCopy}
                    className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    {copied ? "✓ Kopierad!" : "Kopiera annons"}
                  </button>
                </div>
                {listing.title && (
                  <p className="font-semibold text-gray-900 text-sm">{listing.title}</p>
                )}
                {listing.price && (
                  <p className="text-orange-600 font-bold text-lg">{listing.price}</p>
                )}
                {listing.category && (
                  <p className="text-xs text-gray-400 mt-1">Kategori: {listing.category}</p>
                )}
              </div>
            )}

            {/* Input */}
            <div className="border-t border-gray-200 bg-white px-4 py-3 flex gap-2 items-end flex-shrink-0">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder={
                  appState === "done"
                    ? "Be om ändringar i annonsen..."
                    : "Svara på frågan..."
                }
                rows={1}
                className="flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-50 max-h-32 overflow-y-auto"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="w-9 h-9 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
