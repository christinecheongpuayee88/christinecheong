---
title: "Customer Segmentation: RFM Analysis"
description: "A step-by-step visual guide to RFM Analysis — the framework that scores every customer on Recency, Frequency, and Monetary value so you know exactly who to focus on."
date: 2026-05-27
draft: false
---

Every business has customers — but not all customers are equal. Some buy frequently, spend generously, and came back just last week. Others placed one order two years ago and have never returned. Treating both the same way is one of the most common (and costly) mistakes in marketing.

**RFM Analysis** is the framework that fixes this. It scores every customer on three behavioural dimensions — Recency, Frequency, and Monetary value — and uses those scores to group customers into actionable segments. No complex algorithms. No black boxes. Just a clear, systematic view of who your best customers are, who is slipping away, and who you've already lost.

## Interactive Presentation

The presentation below walks through the full RFM framework — from what the letters stand for, to how scores are assigned, to how hurdle rates act as an early-warning health check for your business. It includes narration: click the **🔇** button in the navigation bar to hear the audio commentary for each slide.

<div class="rfm-embed-wrap">
  <iframe
    src="/rfm-animation.html"
    title="Customer Segmentation: RFM Analysis — Interactive Presentation"
    allowfullscreen
    loading="lazy"
  ></iframe>
  <p class="rfm-embed-caption">Use ← → arrow keys or the on-screen buttons to navigate · Click 🔇 for narration · Click ▶ for auto-play</p>
</div>

<style>
  .rfm-embed-wrap {
    margin: 2rem 0 1.5rem;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #0d1335;
  }
  .rfm-embed-wrap iframe {
    width: 100%;
    height: 560px;
    border: none;
    display: block;
  }
  .rfm-embed-caption {
    font-size: 13px !important;
    color: var(--text-3) !important;
    text-align: center;
    padding: 10px 16px !important;
    margin: 0 !important;
    background: var(--surface);
    border-top: 1px solid var(--border);
  }
  @media (max-width: 700px) {
    .rfm-embed-wrap iframe { height: 420px; }
  }
</style>

## What the presentation covers

**Slide 1 — What is RFM?**
The three dimensions explained: Recency (how recently did they buy?), Frequency (how often?), and Monetary (how much do they spend?). Each one matters — and together they give you a precise picture of customer value.

**Slide 2 — Scoring: 1 to 5**
Each dimension is scored independently from 1 (worst) to 5 (best) using quintiles. A customer who scores **555** — the maximum — is your champion: recent, frequent, and high-spending. A customer scoring **111** is lapsed, infrequent, and low-value.

**Slide 3 — The 4-Step Workflow**
From raw transaction data to labelled segments in four steps: collect data → build the RFM table → assign scores → create segments. Each step is concrete and implementable.

**Slide 4 — The 5×5 Segment Map**
A 5-by-5 grid of Recency vs. Frequency reveals 25 distinct customer groups. Champions sit in the top-right. At-Risk customers once bought frequently but haven't recently — a win-back campaign can recover them. Lost customers in the bottom-left are the hardest to reach.

**Slide 5 — Hurdle Rate Analysis**
Hurdle rates track the percentage of your customer base clearing a defined threshold for each RFM dimension (e.g., 30% bought in the last 90 days). Track these over time: rising rates signal a healthy business; falling rates are an early warning that your best customers are drifting.

## Why RFM works

RFM is powerful because it is behavioural, not demographic. It doesn't care where a customer lives, how old they are, or which channel they came from. It measures what they actually *do* — and that turns out to be a far better predictor of what they'll do next.

It is also interpretable. Unlike clustering algorithms that produce groups you have to reverse-engineer, RFM segments have names you can act on immediately: *Champion*, *At Risk*, *Promising*, *Lost*. Your marketing, retention, and service teams can speak the same language.

---

*This presentation is part of the NUS Customer Analytics course series. The next topic is **Cluster Analysis** — where machine learning automatically discovers hidden customer segments without predefined labels.*
