---
title: "Why 'Get More Data' Is Usually the Wrong Answer"
description: "Before you invest in bigger datasets or more complex models, it's worth asking whether the problem is actually a data problem at all."
date: 2026-03-15
draft: false
---

The phrase "we need more data" has become a kind of reflex in data-driven organisations. A model underperforms — get more data. An analysis is inconclusive — get more data. A stakeholder isn't convinced — get more data.

Sometimes this is right. Often it isn't. And the inability to distinguish between the two is one of the most expensive habits in data science.

## The real question is usually not about volume

When a model isn't performing well, the first instinct is to assume the dataset is too small. More training examples, the thinking goes, will help the model learn better patterns.

This is sometimes true. But it misses a more common problem: the data you have doesn't actually contain the information you need to solve the problem.

No amount of additional records will fix that. If customer transaction histories don't predict churn well, the answer is probably not more transaction histories — it's different signals entirely. Interaction with support, time spent in-app, responses to email campaigns. The question to ask is not "how much data do we have?" but "does our data contain the signal we're trying to detect?"

## Four questions before "get more data"

**1. Is the problem actually a data problem?**

Weak model performance can come from many sources: noisy labels, poor feature selection, an inappropriate model for the task, or a problem that's simply hard to predict. Before blaming data volume, examine each of these. A smaller, cleaner, better-labelled dataset will usually outperform a larger messy one.

**2. What would the additional data look like?**

Be specific. "More data" is not a plan. If you can't describe exactly what additional observations would look like and why they'd improve performance, you probably don't know what the problem is yet.

**3. What's the cost of collecting it?**

Data collection is not free. It requires time, money, and often ongoing infrastructure. Before commissioning a new data stream, calculate the expected performance improvement against the cost of getting there. The numbers are often less compelling than they initially appear.

**4. Would better-quality data solve it faster?**

I've seen projects where the team spent months trying to collect more data, when the actual problem was labelling errors in the existing dataset. Fixing 5% of mislabelled training examples improved performance more than doubling the dataset size had.

Quality, relevance, and cleanliness matter more than volume at every stage of the data science process. A dataset that's large but dirty is almost always worse than one that's smaller and clean.

## When more data is genuinely the answer

There are real cases where volume is the binding constraint. Deep learning models — particularly in computer vision and natural language processing — are notoriously data-hungry, and their performance continues to improve with more training data in ways that traditional models do not.

But most business data science problems are not deep learning problems. They're classification tasks, forecasting problems, or cluster analyses that work perfectly well with tens of thousands of records rather than millions.

Before the next "we need more data" conversation, it's worth spending an hour on a different question: *are we actually asking the right question of the data we already have?*

The answer is usually more interesting — and more actionable — than whatever comes from another round of data collection.
