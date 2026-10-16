import UIKit

@MainActor
final class ShareViewController: UIViewController {
    private var processingTask: Task<Void, Never>?
    private var isDismissing = false
    // MARK: - UI Components

    private lazy var backgroundView: UIView = {
        let view = UIView()
        view.backgroundColor = .clear
        view.translatesAutoresizingMaskIntoConstraints = false
        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(dismissExtension))
        view.addGestureRecognizer(tapGesture)
        return view
    }()

    private lazy var containerView: UIView = {
        let view = UIView()
        view.backgroundColor = .systemBackground
        view.layer.cornerRadius = 16
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOpacity = 0.1
        view.layer.shadowOffset = CGSize(width: 0, height: -2)
        view.layer.shadowRadius = 10
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private lazy var loadingIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .medium)
        indicator.startAnimating()
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()

    private lazy var statusLabel: UILabel = {
        let label = UILabel()
        label.text = "Collecting"
        label.textColor = .label
        label.font = .systemFont(ofSize: 16)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private lazy var successImageView: UIImageView = {
        let imageView = UIImageView()
        let config = UIImage.SymbolConfiguration(pointSize: 40, weight: .regular)
        imageView.image = UIImage(systemName: "checkmark.circle.fill", withConfiguration: config)
        imageView.tintColor = .systemGreen
        imageView.isHidden = true
        imageView.translatesAutoresizingMaskIntoConstraints = false
        return imageView
    }()

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()

        processingTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, let self, !self.isDismissing else { return }
            await self.processShareContent()
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        processingTask?.cancel()
    }

    deinit { processingTask?.cancel() }

    // MARK: - Setup

    private func setupUI() {
        view.addSubview(backgroundView)
        view.addSubview(containerView)

        for item in [loadingIndicator, statusLabel, successImageView] {
            containerView.addSubview(item)
        }

        NSLayoutConstraint.activate([
            // Background view
            backgroundView.topAnchor.constraint(equalTo: view.topAnchor),
            backgroundView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            backgroundView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            backgroundView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            // Container view
            containerView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            containerView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            containerView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            containerView.heightAnchor.constraint(equalToConstant: 180),

            // Loading indicator
            loadingIndicator.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            loadingIndicator.centerYAnchor.constraint(equalTo: containerView.centerYAnchor, constant: -20),

            // Status label
            statusLabel.topAnchor.constraint(equalTo: loadingIndicator.bottomAnchor, constant: 16),
            statusLabel.leadingAnchor.constraint(equalTo: containerView.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: containerView.trailingAnchor, constant: -20),

            // Success image view
            successImageView.centerXAnchor.constraint(equalTo: containerView.centerXAnchor),
            successImageView.centerYAnchor.constraint(equalTo: containerView.centerYAnchor, constant: -20),
        ])

        animatePresentation()
    }

    private func animatePresentation() {
        containerView.transform = CGAffineTransform(translationX: 0, y: 200)
        backgroundView.alpha = 0

        UIView.animate(
            withDuration: 0.3,
            delay: 0,
            usingSpringWithDamping: 0.8,
            initialSpringVelocity: 0,
            options: .curveEaseOut
        ) {
            self.containerView.transform = .identity
            self.backgroundView.alpha = 1
        }
    }

    // MARK: - Content Processing

    private func processShareContent() async {
        guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
            showError(message: nil)
            return
        }

        do {
            var sharedContent: String? = nil
            var title: String? = nil

            for item in extensionItems {
                for attachment in item.attachments ?? [] {
                    if let page = try? await loadJavaScriptPreprocessingResults(from: attachment) {
                        title = page.title
                        if sharedContent == nil { sharedContent = page.url }
                    }

                    if attachment.hasItemConformingToTypeIdentifier("public.url") {
                        if let url = try? await attachment.loadItem(forTypeIdentifier: "public.url") as? URL {
                            sharedContent = url.absoluteString
                        }
                    }
                }
            }

            guard let content = sharedContent else {
                showError(message: "No content to share")
                return
            }

            try Task.checkCancellation()
            guard !isDismissing else { return }
            try await ShareCollector.collect(content: content, title: title)
            guard !Task.isCancelled, !isDismissing else { return }
            showSuccess()
        } catch {
            guard !Task.isCancelled, !isDismissing else { return }
            if let failure = error as? ShareFailure, case .message(let message) = failure { showError(message: message) }
            else { showError(message: "Collection failed, please try again.") }
        }
    }

    private func loadJavaScriptPreprocessingResults(from attachment: NSItemProvider) async throws -> SharePage? {
        let propertyList = SharePage.propertyListIdentifier

        guard attachment.hasItemConformingToTypeIdentifier(propertyList) else {
            return nil
        }

        let item = try await attachment.loadItem(forTypeIdentifier: propertyList)

        guard let dictionary = item as? NSDictionary,
              let results = dictionary[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any]
        else {
            return nil
        }

        return SharePage(results: results)
    }

    // MARK: - UI State Updates

    private func showSuccess() {
        let feedbackGenerator = UINotificationFeedbackGenerator()
        feedbackGenerator.notificationOccurred(.success)

        UIView.animate(withDuration: 0.3, animations: {
            self.loadingIndicator.alpha = 0
            self.statusLabel.text = "Success!"
        }) { _ in
            Task {
                self.loadingIndicator.isHidden = true
                self.successImageView.isHidden = false
                self.animateSuccessIcon()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                self.dismissExtension()
            }
        }
    }

    private func animateSuccessIcon() {
        successImageView.transform = CGAffineTransform(scaleX: 0.1, y: 0.1)

        UIView.animate(
            withDuration: 0.5,
            delay: 0,
            usingSpringWithDamping: 0.5,
            initialSpringVelocity: 0,
            options: .curveEaseOut,
            animations: {
                self.successImageView.transform = .identity
            }
        ) { _ in
            UIView.animate(withDuration: 0, delay: 1.0, options: []) {} completion: { _ in
                self.dismissExtension()
            }
        }
    }

    private func showError(message: String?) {
        let feedbackGenerator = UINotificationFeedbackGenerator()
        feedbackGenerator.notificationOccurred(.error)

        statusLabel.text = message ?? "Failed!"
        statusLabel.textColor = .systemRed
        statusLabel.numberOfLines = 0
        loadingIndicator.stopAnimating()
    }

    // MARK: - Dismissal

    @objc private func dismissExtension() {
        guard !isDismissing else { return }
        isDismissing = true
        processingTask?.cancel()
        UIView.animate(withDuration: 0.3, animations: {
            self.containerView.transform = CGAffineTransform(translationX: 0, y: 200)
            self.backgroundView.alpha = 0
        }) { _ in
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}

// MARK: - NSItemProvider Extension

extension NSItemProvider {
    func loadItem(forTypeIdentifier typeIdentifier: String) async throws -> NSSecureCoding? {
        try await withCheckedThrowingContinuation { continuation in
            loadItem(forTypeIdentifier: typeIdentifier, options: nil) { item, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: item)
                }
            }
        }
    }
}
