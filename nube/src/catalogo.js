// Generado a partir del sondeo en vivo de proveedores (2026-11-07).
// Orden = preferencia. Las claves NO van aquí: son secretos del Worker (KEY_<PLATAFORMA>).
export const CATALOGO = {
  "providers": {
    "groq": {
      "url": "https://api.groq.com/openai/v1/chat/completions",
      "auth": "bearer",
      "secretName": "KEY_GROQ",
      "extraHeaders": {}
    },
    "nvidia": {
      "url": "https://integrate.api.nvidia.com/v1/chat/completions",
      "auth": "bearer",
      "secretName": "KEY_NVIDIA",
      "extraHeaders": {}
    },
    "google": {
      "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "auth": "bearer",
      "secretName": "KEY_GOOGLE",
      "extraHeaders": {}
    },
    "agnes": {
      "url": "https://apihub.agnes-ai.com/v1/chat/completions",
      "auth": "bearer",
      "secretName": "KEY_AGNES",
      "extraHeaders": {}
    },
    "kilo": {
      "url": "https://api.kilo.ai/api/gateway/v1/chat/completions",
      "auth": "none",
      "secretName": null,
      "extraHeaders": {}
    },
    "ovh": {
      "url": "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
      "auth": "none",
      "secretName": null,
      "extraHeaders": {}
    },
    "zhipu": {
      "url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      "auth": "bearer",
      "secretName": "KEY_ZHIPU",
      "extraHeaders": {}
    },
    "llm7": {
      "url": "https://api.llm7.io/v1/chat/completions",
      "auth": "none",
      "secretName": null,
      "extraHeaders": {}
    }
  },
  "modes": {
    "neutral": [
      {
        "platform": "groq",
        "model": "openai/gpt-oss-120b"
      },
      {
        "platform": "nvidia",
        "model": "nvidia/nemotron-3-ultra-550b-a55b"
      },
      {
        "platform": "google",
        "model": "gemini-3.5-flash"
      },
      {
        "platform": "agnes",
        "model": "agnes-3.0-flash"
      },
      {
        "platform": "groq",
        "model": "qwen/qwen3.8-27b"
      },
      {
        "platform": "kilo",
        "model": "dots-studio/dots-3-note-preview:free"
      },
      {
        "platform": "ovh",
        "model": "Meta-Llama-3_3-70B-Instruct"
      }
    ],
    "libre": [
      {
        "platform": "groq",
        "model": "qwen/qwen3.8-27b"
      },
      {
        "platform": "nvidia",
        "model": "minimaxai/minimax-m3.1-flash"
      },
      {
        "platform": "ovh",
        "model": "Mistral-Small-3.2-24B-Instruct-2506"
      },
      {
        "platform": "ovh",
        "model": "Qwen3.5-397B-A17B"
      },
      {
        "platform": "ovh",
        "model": "Meta-Llama-3_3-70B-Instruct"
      },
      {
        "platform": "zhipu",
        "model": "glm-4.5-flash"
      }
    ],
    "tecnico": [
      {
        "platform": "groq",
        "model": "openai/gpt-oss-120b"
      },
      {
        "platform": "ovh",
        "model": "Qwen3.5-397B-A17B"
      },
      {
        "platform": "nvidia",
        "model": "poolside/laguna-xs-2.1"
      },
      {
        "platform": "kilo",
        "model": "cohere/north-mini-code:free"
      },
      {
        "platform": "llm7",
        "model": "codestral-latest"
      },
      {
        "platform": "nvidia",
        "model": "minimaxai/minimax-m3.1-flash"
      },
      {
        "platform": "ovh",
        "model": "gpt-oss-120b"
      },
      {
        "platform": "zhipu",
        "model": "glm-4.5-flash"
      }
    ]
  },
  "fusion": {
    "panel": [
      {
        "platform": "groq",
        "model": "openai/gpt-oss-120b"
      },
      {
        "platform": "nvidia",
        "model": "minimaxai/minimax-m3.1-flash"
      },
      {
        "platform": "agnes",
        "model": "agnes-3.0-flash"
      }
    ],
    "panelFallback": [
      {
        "platform": "google",
        "model": "gemini-3.5-flash"
      },
      {
        "platform": "nvidia",
        "model": "nvidia/nemotron-3-ultra-550b-a55b"
      },
      {
        "platform": "ovh",
        "model": "Qwen3.5-397B-A17B"
      }
    ],
    "synth": {
      "platform": "groq",
      "model": "qwen/qwen3.8-27b"
    }
  }
};
