---
title: "Fast Minimum-norm Adversarial Attacks through Adaptive Norm Constraints"
collection: publications
permalink: /publication/2021-25-02-pintor-fast-minimum-norm
excerpt: 'Evaluating adversarial robustness amounts to finding the minimum perturbation needed to have an input sample misclassified. The inherent complexity of the underlying optimization requires current gradient-based attacks to be carefully tuned, initialized, and possibly executed for many computationally-demanding iterations, even if specialized to a given perturbation model. In this work, we overcome these limitations by proposing a fast minimum-norm (FMN) attack that works with different ℓp-norm perturbation models (p=0,1,2,∞), is robust to hyperparameter choices, does not require adversarial starting points, and converges within few lightweight steps. It works by iteratively finding the sample misclassified with maximum confidence within an ℓp-norm constraint of size ϵ, while adapting ϵ to minimize the distance of the current sample to the decision boundary. Extensive experiments show that FMN significantly outperforms existing attacks in terms of convergence speed and computation time, while reporting comparable or even smaller perturbation sizes.'
date: 2021-25-02
venue: 'arXiv preprint arXiv:2102.12827 (2021)'
paperurl: 'https://arxiv.org/pdf/2102.12827.pdf'
citation: 'Maura Pintor, Fabio Roli, Wieland Brendel, Battista Biggio, &apos;Fast Minimum-norm Adversarial Attacks through Adaptive Norm Constraints&apos;, arXiv preprint arXiv:2102.12827, 2021'
---

<a href='https://arxiv.org/pdf/2102.12827.pdf'>Download paper here</a>

Evaluating adversarial robustness amounts to finding the minimum perturbation needed to have an input sample misclassified. The inherent complexity of the underlying optimization requires current gradient-based attacks to be carefully tuned, initialized, and possibly executed for many computationally-demanding iterations, even if specialized to a given perturbation model. In this work, we overcome these limitations by proposing a fast minimum-norm (FMN) attack that works with different ℓp-norm perturbation models (p=0,1,2,∞), is robust to hyperparameter choices, does not require adversarial starting points, and converges within few lightweight steps. It works by iteratively finding the sample misclassified with maximum confidence within an ℓp-norm constraint of size ϵ, while adapting ϵ to minimize the distance of the current sample to the decision boundary. Extensive experiments show that FMN significantly outperforms existing attacks in terms of convergence speed and computation time, while reporting comparable or even smaller perturbation sizes.

Recommended citation: Maura Pintor, Fabio Roli, Wieland Brendel, Battista Biggio, 'Fast Minimum-norm Adversarial Attacks through Adaptive Norm Constraints', arXiv preprint arXiv:2102.12827, 2021