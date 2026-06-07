# Agentic Commerce Demo

This context defines the product language for the hackathon-oriented agentic commerce demo. It keeps the buying, authorization, payment, delivery, and audit concepts distinct.

## Language

**Paid Resource**:
An online resource that requires an x402 payment before its content or service result is delivered. In the MVP, the resource is provided by the user or demo system rather than discovered through open-ended web search.
_Avoid_: Search result, purchase link

**Purchasing Capability**:
The generic ability for an agent to inspect an x402 paid resource, decide whether it fits user constraints, obtain CAW authorization, execute payment, recover delivery, and produce audit evidence.
_Avoid_: Risk-report product, provider service

**Example Paid Resource**:
A concrete paid resource used to prove the purchasing capability end to end. In this repo, the risk report endpoint is the example paid resource, not the generic capability itself.
_Avoid_: Core capability, whole project

**Demo Provider**:
A local paid-resource service used to make the buyer flow reproducible when no suitable public x402 service is available. It is supporting cast for the demo, not the product protagonist.
_Avoid_: Core product, agent

**Purchase Intent**:
The agent's structured understanding of what should be bought, why it is allowed, and under which budget and provider constraints. It is derived from the user request plus the x402 payment requirement.
_Avoid_: Prompt, order text

**CAW Pact**:
The owner-approved authorization boundary that lets the agent execute payment operations only within declared intent, policy, and completion conditions.
_Avoid_: Wallet popup, API key

**Agent Runtime**:
The existing environment that interprets a user task and invokes tools, such as Codex, Claude Code, or another agent framework. The demo does not require building a new vertical agent application from scratch.
_Avoid_: Product, wallet

**Agent-Facing API**:
Backend provider endpoints designed to be called by an agent runtime through the purchasing skill. The MVP does not require a separate browser UI or consumer frontend.
_Avoid_: Frontend, dashboard

**Purchasing Skill**:
A reusable agent capability that turns a paid-resource request into a purchase intent, CAW Pact, payment execution, delivery validation, and audit record. It combines workflow instructions with deterministic helper tools.
_Avoid_: Chat prompt only, standalone app

**Authorization Boundary**:
The approved limit within which the agent may execute payment operations without asking the owner to approve each individual step. It is defined by the purchase intent, CAW Pact policy, and completion conditions.
_Avoid_: Full autonomy, unrestricted wallet access

**Duplicate Payment Guard**:
A safety check that prevents the agent from paying again when a matching purchase has already been paid, delivered, or is still recoverable from provider, agent-side, CAW, or chain evidence.
_Avoid_: Retry, idempotency only

**Provider Order**:
The seller-side record for a paid resource purchase, including payment requirement, payment status, delivery status, and recovery state. It is authoritative for whether that provider has already accepted payment and delivered the resource.
_Avoid_: Agent memory, wallet transaction

**Provider Capability**:
A seller-side action the agent can call, such as quoting a paid resource, checking order status, recovering a delivered result, or retrying a paid request. The agent plans around these capabilities instead of treating payment as a blind transfer.
_Avoid_: Internal endpoint, manual step

**Provider Capability Manifest**:
An agent-readable description of the provider's paid resources and recovery capabilities, such as a `llms.txt`-style document. It helps the agent discover how to quote, check status, recover delivery, and understand payment constraints.
_Avoid_: Marketing page, hidden API docs

**Agent Decision Layer**:
The part of the purchasing skill that decides which provider capability to call next based on user intent, quote details, authorization state, prior evidence, and delivery status.
_Avoid_: Script runner, payment client

**Invocation Template**:
A documented command pattern that shows an agent runtime how to call an existing helper or consumer flow safely for a specific purchase scenario. It belongs in the purchasing skill as guidance, while the executable command remains in the underlying tool.
_Avoid_: Implementation, hidden operator habit

**Demo Interaction Pattern**:
The demonstration flow where the operator opens an agent runtime, confirms the purchasing skill is available, states a purchase intent, and lets the agent runtime execute the skill-guided workflow.
_Avoid_: Manual command walkthrough, frontend demo

**Audit Record**:
The evidence bundle for one attempted purchase, including the request, quote, authorization summary, payment result, delivery validation, and failure reason when applicable.
_Avoid_: Log file, receipt only
