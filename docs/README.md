# Документация проекта

## docs/avito-skill/

Скилл для работы с бизнес-сценариями Avito (порт из репозитория
[18studio/avito-skill](https://github.com/18studio/avito-skill)).

- `SKILL.md` — основной файл скилла: правила, безопасность, навигация.
- `references/decision-rules.md` — правила превращения метрик в решения.
- `references/business-scenarios.md` — типовые бизнес-сценарии и какие методы SDK используются.
- `references/sdk-domain-map.md` — карта доменов SDK `avito-py`
  ([p141592/avito_python_api](https://github.com/p141592/avito_python_api)).
- `references/safety.md` — правила безопасности и защиты от случайных платных
  операций.

**Где это используется в коде:**

- Логика `previewDecision()` в `src/lib/recommendations.ts` — порт функции
  `preview_decision()` из оригинального Python-скрипта
  `scripts/promotion_decision_preview.py`. Возвращает один из ярлыков:
  `promote_candidate`, `do_not_promote_yet`, `improve_listing_first`,
  `stop_or_reduce_spend`, `test_low_budget`, `inspect_current_promotion`.
- Группы рекомендаций в `buildRecommendations()` — взяты из
  `business-scenarios.md` (Lead Leakage, Stale Inventory).

## docs/avito-api/

Скилл для работы с публичным Avito Business API (порт из репозитория
[MissiaL/avito-api](https://github.com/MissiaL/avito-api)).

- `SKILL.md` — описание авторизации (OAuth2 Client Credentials), правила
  навигации по 197 эндпоинтам, типичные паттерны и подводные камни.
- `index.md` — плоский список всех эндпоинтов с описаниями.
- `sections/<slug>.md` — официальные интеграционные доки Avito по разделам:
  `accounts-hierarchy`, `auction`, `auth`, `autoload`, `autostrategy`,
  `autoteka`, `calltracking`, `cpa`, `cpxpromo`, `delivery-sandbox`, `item`,
  `job`, `messenger`, `order-management`, `promotion`, `ratings`,
  `sbc-gateway`, `stock-management`, `str`, `tariff`, `trxpromo`, `user`.

**Где это используется в коде:**

- `backend/server.js` — серверный прокси, эндпоинты которого построены
  поверх путей и схем из этих доков:
  - `/api/health`, `/api/account/*` — раздел `user` и `accounts-hierarchy`.
  - `/api/items` — раздел `item`.
  - `/api/stats/*` — статистика из `item` (раздел статистики).
  - `/api/promotion/*` — раздел `promotion`.
  - `/api/cpx/*` — раздел `cpxpromo` (цена целевого действия).
  - `/api/messenger/*` — раздел `messenger` (v1 для отправки, v2 для чтения).

При расширении интеграции **сначала читайте соответствующий
`sections/<slug>.md`** — там содержатся гайды по sandbox, скоупам, лимитам
и edge-cases, которых нет в OpenAPI-схеме.

## Полный OpenAPI-спек

Полный OpenAPI 3.0 спек (~1.7 МБ, 197 путей) **не хранится в репозитории**,
чтобы не раздувать его. При необходимости клонируйте оригинал:

```bash
git clone https://github.com/MissiaL/avito-api ~/_avito-api-ref
jq '.components.schemas.stocksInfoResult' ~/_avito-api-ref/references/avito-api-openapi.json
```
