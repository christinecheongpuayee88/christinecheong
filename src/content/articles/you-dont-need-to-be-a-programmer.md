---
title: "You Don't Need to Be a Programmer to Lead a Data Science Team"
description: "A guide for managers and executives who work with data scientists but don't write code themselves — what to understand, what to delegate, and what questions to ask."
date: 2026-04-10
draft: false
---

One of the most persistent myths in data science is that you need to understand the code to lead the work. You don't. What you need is something harder to teach: the ability to ask good questions, evaluate claims critically, and make sound decisions about where and how to invest in data capabilities.

I've worked with senior leaders who could read Python fluently and consistently made poor decisions about data projects. And I've worked with leaders who couldn't write a line of code but ran highly effective data teams. The difference wasn't technical skill. It was judgment.

## What you actually need to understand

**The difference between description and prediction**

Data science work broadly falls into two types: understanding what happened (descriptive analytics), and estimating what will happen or what to do (predictive and prescriptive analytics). These have different data requirements, different timelines, and different standards for "good enough."

A leader who confuses these will repeatedly ask their team for the wrong thing, and be confused when they don't get it.

**What a model can and cannot do**

Models are not oracles. They are sophisticated pattern-matching tools trained on historical data. They work well when the future resembles the past. They fail — sometimes spectacularly — when it doesn't.

You don't need to know how a gradient boosted tree works. You do need to know that every model has limits, that those limits depend on the training data, and that "the model says so" is not a complete justification for a business decision.

**The difference between accuracy and usefulness**

A model that is 97% accurate sounds impressive. Whether it's useful depends entirely on what the 3% errors look like, and how much they cost. A medical screening tool that misses 3% of positive cases is very different from a product recommendation engine that makes 3% suboptimal suggestions.

Ask your team: "What does a wrong prediction look like, and how often does it happen?"

## What you can safely delegate

- **Model selection and architecture.** Let your data scientists argue about this. Your job is to define the problem clearly enough that they can make good choices.
- **Data cleaning and pipeline work.** This is important, time-consuming, and deeply technical. You don't need to understand the specifics; you need to budget time and resources for it.
- **Hyperparameter tuning and optimisation.** Genuinely not your concern unless the performance gap is meaningful for the business outcome.

## The questions worth asking in every data project

1. **What decision will this analysis change?** If there's no clear answer, the project might not be worth doing.
2. **What would we do differently if the result came back the opposite way?** A useful sanity check for whether the analysis is actually influencing anything.
3. **How confident are we in the data quality?** Most analytical errors trace back to data problems, not model problems.
4. **When will we know if this worked?** Define success criteria before the work starts, not after.
5. **Who needs to understand this result, and how will we communicate it?** Planning for communication at the start changes how the analysis is structured and presented.

Leading a data science team well is less about understanding statistics and more about creating the conditions for good work: clear problems, clean data, protected time, and honest feedback loops. Those are leadership skills, not technical ones.
