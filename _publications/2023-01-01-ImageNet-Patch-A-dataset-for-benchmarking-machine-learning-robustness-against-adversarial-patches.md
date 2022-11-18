---
title: "ImageNet-Patch: A dataset for benchmarking machine learning robustness against adversarial patches"
collection: publications
permalink: /publications/2023-01-01-ImageNet-Patch-A-dataset-for-benchmarking-machine-learning-robustness-against-adversarial-patches
pubtype: journal
date: 2023-01-01
venue: 'Pattern Recognition'
paperurl: 'https://arxiv.org/abs/2203.04412'
citation: ' Maura Pintor,  Daniele Angioni,  Angelo Sotgiu,  Luca Demetrio,  Ambra Demontis,  Battista Biggio,  Fabio Roli, &quot;ImageNet-Patch: A dataset for benchmarking machine learning robustness against adversarial patches.&quot; Pattern Recognition, 2023.'
---
Abstract:

Adversarial patches are optimized contiguous pixel blocks in an input image that cause a machine-learning model to misclassify it. However, their optimization is computationally demanding, and requires careful hyperparameter tuning, potentially leading to suboptimal robustness evaluations. To overcome these issues, we propose ImageNet-Patch, a dataset to benchmark machine- learning models against adversarial patches. It consists of a set of patches, optimized to generalize across different models, and readily applicable to ImageNet data after preprocessing them with affine transformations. This process enables an approximate yet faster robustness evaluation, leveraging the transferability of adversarial perturbations. We showcase the usefulness of this dataset by testing the effectiveness of the computed patches against 127 models. We conclude by discussing how our dataset could be used as a benchmark for robustness, and how our methodology can be generalized to other domains. We open source our dataset and evaluation code at https://github.com/pralab/ImageNet-Patch.

[Access paper here](https://arxiv.org/abs/2203.04412){:target="_blank"}

BibTeX: 
>@article{pintor2023imagenet,<br>    author = {Pintor, Maura and Angioni, Daniele and Sotgiu, Angelo and Demetrio, Luca and Demontis, Ambra and Biggio, Battista and Roli, Fabio},<br>    title = {ImageNet-Patch: A dataset for benchmarking machine learning robustness against adversarial patches},<br>    journal = {Pattern Recognition},<br>    volume = {134},<br>    pages = {109064},<br>    year = {2023},<br>    publisher = {Elsevier},<br>    url = {https://arxiv.org/abs/2203.04412}<br>}<br>