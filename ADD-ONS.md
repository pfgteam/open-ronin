# Open Ronin add-ons

72 popular open-source projects that cover functions Open Ronin doesn't, or that teams may want to swap in. Grouped by Open Ronin's menus. Star counts are from GitHub on 2026-11-11.

## How add-ons fit

- **Separate services, connected rather than bundled.** Each add-on runs as its own app and talks to Open Ronin through Admin › Connections, webhooks or its API. Open Ronin stays Unlicense (public domain), and each add-on keeps its own license.
- **Check the license column before you self-host or resell.** "Open core" means the main code is open but some features are paid. "Source-available" and "fair-code" are not OSI open source and limit commercial use.
- **Ask your agent to do it.** For example: *"Read ADD-ONS.md and open-ronin.config.yaml. Install <add-on> with Docker next to my Open Ronin, connect it through webhooks or its API, and test the connection."*
- **Suggest more** by opening an issue or a PR against this file.

## Contents

- [Work: projects, automation and agents](#work-projects-automation-and-agents)
- [Clients: CRM, support and portals](#clients-crm-support-and-portals)
- [Growth: marketing, outreach and analytics](#growth-marketing-outreach-and-analytics)
- [Studio: content, social and media](#studio-content-social-and-media)
- [Team: communication, knowledge and people](#team-communication-knowledge-and-people)
- [Management: data, dashboards and platform](#management-data-dashboards-and-platform)

## Work: projects, automation and agents

| Project | What it does | Use it in Open Ronin for | Stars | License |
|---|---|---|---|---|
| [n8n](https://github.com/n8n-io/n8n) | Workflow automation with AI nodes (Zapier alternative) | Glue between Open Ronin and every other tool, via webhooks | 210.2k | Fair-code (Sustainable Use License, not OSI) |
| [dify](https://github.com/langgenius/dify) | Build agent workflows and RAG apps | Client-facing AI assistants and internal agents | 161k | Modified Apache-2.0 |
| [plane](https://github.com/makeplane/plane) | Project tracking (Jira/Linear/ClickUp alternative) | Projects and tasks for teams that want a dedicated PM tool next to The Work | 62.3k | AGPL-3.0 |
| [huginn](https://github.com/huginn/huginn) | Agents that watch the web and act | Alerts and monitors that feed Work items | 50.5k | MIT |
| [Huly](https://github.com/hcengineering/platform) | Huly: all-in-one PM, chat and docs | One self-hosted workspace for dev-style teams | 28.1k | EPL-2.0 |
| [activepieces](https://github.com/activepieces/activepieces) | Workflow automation with about 400 MCP servers | Automations that AI agents can call | 25.5k | Open core: MIT (enterprise parts paid) |
| [windmill](https://github.com/windmill-labs/windmill) | Code-first scripts, workflows and internal apps | Scheduled jobs and back-office scripts | 18.5k | Open core: AGPL/Apache (enterprise parts paid) |
| [openproject](https://github.com/opf/openproject) | Classic project management: Gantt, budgets, time | Larger client programs with timelines | 17.3k | GPL-3.0 |

## Clients: CRM, support and portals

| Project | What it does | Use it in Open Ronin for | Stars | License |
|---|---|---|---|---|
| [twenty](https://github.com/twentyhq/twenty) | Modern CRM (Salesforce alternative) | Full CRM if you outgrow the built-in Clients and Growth | 60.8k | AGPL-3.0, some commercial files |
| [cal.diy](https://github.com/calcom/cal.diy) | Scheduling links (Calendly alternative) | Client calls and intake meetings booked straight into calendars | 49.9k | MIT |
| [chatwoot](https://github.com/chatwoot/chatwoot) | Omnichannel inbox: chat, email, social DMs | Client tickets from every channel | 39.6k | Open core: MIT (enterprise parts paid) |
| [docuseal](https://github.com/docusealco/docuseal) | E-signature and fillable documents | Onboarding forms and agreements | 19k | AGPL-3.0 |
| [documenso](https://github.com/documenso/documenso) | E-signature (DocuSign alternative) | Contracts and SOWs signed from the client record | 15.7k | AGPL-3.0 |
| [invoiceninja](https://github.com/invoiceninja/invoiceninja) | Invoices, quotes and payments | Client billing tied to packages | 10.6k | Source-available (Elastic License 2.0) |
| [zammad](https://github.com/zammad/zammad) | Helpdesk and ticketing | Formal support desk with SLAs | 6.1k | AGPL-3.0 |
| [espocrm](https://github.com/espocrm/espocrm) | Lightweight CRM | Simple contact and deal tracking | 3.6k | AGPL-3.0 |
| [InvoiceShelf](https://github.com/InvoiceShelf/InvoiceShelf) | Simple invoicing | Lightweight billing for small teams | 1.9k | AGPL-3.0 |

## Growth: marketing, outreach and analytics

| Project | What it does | Use it in Open Ronin for | Stars | License |
|---|---|---|---|---|
| [posthog](https://github.com/PostHog/posthog) | Product analytics, session replay and flags | Deeper analytics for app or product clients | 40.7k | Open core: MIT (enterprise parts paid) |
| [umami](https://github.com/umami-software/umami) | Privacy-first web analytics | Lightweight traffic tracking across many client sites | 40.1k | MIT |
| [changedetection.io](https://github.com/dgtlmoon/changedetection.io) | Website change monitoring | Watch competitor, media and client pages for changes | 35.7k | Apache-2.0 |
| [analytics](https://github.com/plausible/analytics) | Privacy-first web analytics | Client site traffic in reports | 29.8k | AGPL-3.0 |
| [dub.link](https://github.com/dubinc/dub.link) | Short links with click attribution | Track which pitch, post or campaign drove the click | 25.2k | Open core: AGPL (enterprise parts paid) |
| [listmonk](https://github.com/knadh/listmonk) | Newsletters and mailing lists | Client and prospect newsletters at scale | 24.3k | AGPL-3.0 |
| [matomo](https://github.com/matomo-org/matomo) | Full Google Analytics alternative | Clients that need GA-style reporting | 22k | GPL-3.0 |
| [mautic](https://github.com/mautic/mautic) | Marketing automation (HubSpot alternative) | Nurture sequences and lead scoring | 11k | GPL-3.0 |
| [serpbear](https://github.com/towfiqi/serpbear) | Search rank tracking | SEO/GEO health and keyword positions | 2.2k | MIT |

## Studio: content, social and media

| Project | What it does | Use it in Open Ronin for | Stars | License |
|---|---|---|---|---|
| [firecrawl](https://github.com/firecrawl/firecrawl) | Web scraping and search for AI agents | Scrapers feeding Studio and Growth | 200.8k | AGPL-3.0 |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Node-based image and video generation | Creative assets on your own GPU | 146.3k | GPL-3.0 |
| [excalidraw](https://github.com/excalidraw/excalidraw) | Hand-drawn whiteboard | Strategy sessions and campaign maps | 135.5k | MIT |
| [immich](https://github.com/immich-app/immich) | Photo and video library | Client media and brand asset libraries | 118.8k | AGPL-3.0 |
| [whisper](https://github.com/openai/whisper) | Speech-to-text | Transcribe calls, podcasts and interviews | 112.5k | MIT |
| [crawl4ai](https://github.com/unclecode/crawl4ai) | LLM-ready web crawling | Social listening, media lists and research | 87.2k | Apache-2.0 |
| [obs-studio](https://github.com/obsproject/obs-studio) | Recording and live streaming | Podcast and video production | 79.4k | GPL-2.0 |
| [strapi](https://github.com/strapi/strapi) | Headless CMS | Content APIs for client sites and apps | 73.5k | Open core: MIT (enterprise parts paid) |
| [penpot](https://github.com/penpot/penpot) | Design and prototyping (Figma alternative) | Brand and social design work | 62.3k | MPL-2.0 |
| [Ghost](https://github.com/TryGhost/Ghost) | Publishing, newsletters and memberships | Client blogs and paid newsletters | 55.8k | MIT |
| [payload](https://github.com/payloadcms/payload) | Next.js headless CMS | Client websites built on the same stack | 45.8k | MIT |
| [postiz-app](https://github.com/gitroomhq/postiz-app) | Agentic social media scheduling | Post scheduling and publishing across networks | 41.4k | AGPL-3.0 |
| [whisperX](https://github.com/m-bain/whisperX) | Fast transcription with speaker labels | Meeting notes and action items from recordings | 25.2k | BSD-2-Clause |
| [Cap](https://github.com/CapSoftware/Cap) | Screen recording (Loom alternative) | Async walkthroughs for clients | 24.9k | Mixed, see LICENSE |
| [mixpost](https://github.com/inovector/mixpost) | Social media scheduling and management | Simpler scheduler alternative | 3.9k | MIT |

## Team: communication, knowledge and people

| Project | What it does | Use it in Open Ronin for | Stars | License |
|---|---|---|---|---|
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | Notion alternative | Docs, wikis and personal planning | 78.7k | AGPL-3.0 |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | Docs plus whiteboard (Notion + Miro) | Planning and brainstorming | 74.5k | Mixed, see LICENSE |
| [Rocket.Chat](https://github.com/RocketChat/Rocket.Chat) | Team and client chat | Chat with client guest access | 46.5k | Open core: MIT (enterprise parts paid) |
| [outline](https://github.com/outline/outline) | Team knowledge base | SOPs, playbooks and onboarding docs | 41.2k | Source-available (BSL 1.1) |
| [mattermost](https://github.com/mattermost/mattermost) | Team chat (Slack alternative) | Internal chat if you leave Slack | 39.6k | Open core: AGPL-3.0 source, MIT binaries |
| [jitsi-meet](https://github.com/jitsi/jitsi-meet) | Video meetings (Zoom alternative) | Internal and client calls | 30.2k | Apache-2.0 |
| [zulip](https://github.com/zulip/zulip) | Threaded team chat | Async-heavy teams | 26.2k | Apache-2.0 |
| [docmost](https://github.com/docmost/docmost) | Wiki and documentation | Knowledge base with a fully open license | 22.3k | AGPL-3.0 |
| [formbricks](https://github.com/formbricks/formbricks) | Surveys (Qualtrics alternative) | Client NPS, team pulse and check-ins | 13.2k | Open core: AGPL (enterprise parts paid) |
| [heyform](https://github.com/heyform/heyform) | Conversational form builder | Intake and onboarding forms | 9.1k | AGPL-3.0 |
| [hrms](https://github.com/frappe/hrms) | HR and payroll | Leave, payroll and HR records beyond Open Ronin's Team module | 9k | GPL-3.0 |
| [kimai](https://github.com/kimai/kimai) | Time tracking | Hours by client and project for profitability | 5.1k | AGPL-3.0 |
| [LimeSurvey](https://github.com/LimeSurvey/LimeSurvey) | Advanced survey platform | Research and large surveys | 3.8k | GPL-2.0+ |

## Management: data, dashboards and platform

| Project | What it does | Use it in Open Ronin for | Stars | License |
|---|---|---|---|---|
| [open-webui](https://github.com/open-webui/open-webui) | Self-hosted ChatGPT-style interface | Team AI chat on your own keys and models | 158.4k | Custom (BSD-style with branding clause) |
| [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) | PDF toolkit | Merge, sign, redact and convert deliverables | 96.3k | Open core: MIT (enterprise parts paid) |
| [uptime-kuma](https://github.com/louislam/uptime-kuma) | Uptime monitoring | Watch Open Ronin and client sites | 93.5k | MIT |
| [superset](https://github.com/apache/superset) | Data exploration and visualization | Heavier analytics and SQL dashboards | 75.5k | Apache-2.0 |
| [vaultwarden](https://github.com/dani-garcia/vaultwarden) | Password manager server (Bitwarden-compatible) | Shared client logins kept out of chat | 70.6k | AGPL-3.0 |
| [anything-llm](https://github.com/Mintplex-Labs/anything-llm) | Chat with your documents (RAG) | Ask questions across the knowledge base and client files | 68.2k | MIT |
| [nocodb](https://github.com/nocodb/nocodb) | Airtable alternative over any database | Spreadsheet views for ops teams | 65.5k | Mixed, see LICENSE |
| [odoo](https://github.com/odoo/odoo) | Business app suite (community edition) | Accounting, invoicing and HR in one | 55.7k | LGPL-3.0 (community) |
| [metabase](https://github.com/metabase/metabase) | BI dashboards and questions | Exec dashboards over the Open Ronin database | 50.3k | Open core: AGPL-3.0 (enterprise parts paid) |
| [paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | Document scanning and OCR archive | Contracts, receipts and records | 48k | GPL-3.0 |
| [LibreChat](https://github.com/LibreChat-AI/LibreChat) | Multi-model AI chat with agents and MCP | Team AI chat across providers | 47k | MIT |
| [appsmith](https://github.com/appsmithorg/appsmith) | Internal tool builder | Custom admin screens without touching core | 41.2k | Apache-2.0 |
| [erpnext](https://github.com/frappe/erpnext) | ERP: accounting, inventory, purchasing | Finance and back office for larger agencies | 41.2k | GPL-3.0 |
| [novu](https://github.com/novuhq/novu) | Notification infrastructure | Email, SMS, push and in-app alerts | 40.3k | Open core: MIT (enterprise parts paid) |
| [server](https://github.com/nextcloud/server) | Files, sharing and office suite | Client file drops and shared folders | 37.5k | AGPL-3.0 |
| [budibase](https://github.com/Budibase/budibase) | Internal apps and automations | Departmental mini-apps | 28.4k | GPL-3.0 |
| [teable](https://github.com/teableio/teable) | AI spreadsheet on Postgres | Spreadsheet-style views over the same data | 22k | Open core: AGPL (enterprise parts paid) |
| [baserow](https://github.com/baserow/baserow) | No-code databases and apps | Lightweight client trackers | 6.3k | Open core: MIT (enterprise parts paid) |
